// The in-node tool loop — vision.md's "second heart". Pure: driven by an injected
// `chatCall` (the one seam), so termination, caps, error-as-result, and wire-truth
// are all testable with a scripted fake. runAgent wires the real client in.
//
// Wire-truth invariant: the message list is append-only, chronological, verbatim.
// Assistant messages are appended as the exact objects the chatCall returned, so
// provider extras (`reasoning`, `reasoning_details`, gemma's
// `extra_content.google.thought_signature`) ride along untouched. Streaming
// makes those objects reconstructions rather than responses — the narrowed rule
// and what it cost lives with the reconstruction, in ./streamAssembly.ts (#34).
// Tools are declared on every call, including the forced final (#18 finding: an
// undeclared tool provokes MALFORMED_FUNCTION_CALL dead-ends).
//
// Transient-retry policy lives in the injected chatCall, not here: the real
// wiring (runner.ts `withRetry`) retries 429 and 5xx only. Explicitly not 400s —
// #18's apparent "intermittent 400s" were two env footguns (a CRLF-induced \r on
// the model name, a trailing-slash base URL), never flakiness, and a retry would
// have hidden them for longer. Either way the loop treats one chatCall as one
// settled model turn.
import { ToolCallRecord } from '../types'
import { JsonSchema } from './spec'
import type { ToolNarration } from './events'
import type { BoundTool } from './registry'

export interface WireToolCall {
  id: string
  type?: string
  function: { name: string; arguments: string }
  [extra: string]: unknown
}

export interface AssistantWireMessage {
  role: 'assistant'
  content?: string | null
  tool_calls?: WireToolCall[] | null
  [extra: string]: unknown // reasoning, reasoning_details, extra_content — echoed verbatim
}

export type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | AssistantWireMessage
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatCallRequest {
  messages: WireMessage[]
  tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: JsonSchema } }>
  tool_choice?: 'none'
}

// Structural subset of the chat.completions response (shape pinned by
// scripts/derisk artifacts); the non-streamed client return value is assignable
// as-is, and streamAssembly rebuilds the same shape from chunks.
export interface ChatCallResponse {
  choices: Array<{ message: AssistantWireMessage; finish_reason?: string | null }>
  usage?: { prompt_tokens: number; completion_tokens: number } | null
}

// Stream facts the adapter reports upward while a turn is in flight. Deliberately
// turn-less: the loop owns turn numbering and stamps these on the way out (#35).
// A non-streaming chatCall simply never calls them.
export interface ChatCallHooks {
  onToolCallStart?: () => void
  onToken?: (token: string, type: 'thought' | 'output') => void
}

export type ChatCall = (req: ChatCallRequest, hooks?: ChatCallHooks) => Promise<ChatCallResponse>

export interface ToolLoopResult {
  finalText: string
  // Every turn's `reasoning`, for providers that use it instead of <thought> tags.
  // Display only; `reasoning_details` stays the replay representation (#35).
  reasoning: string
  messages: WireMessage[]
  toolCalls: ToolCallRecord[]
  toolTurns: number
  tokensIn: number
  tokensOut: number
}

// Thrown on failures the loop cannot turn into a tool result (API failure,
// dead-end MALFORMED_FUNCTION_CALL turns). Carries the transcript-so-far so the
// caller can preserve it in AgentOutput and the log.
export class ToolLoopError extends Error {
  constructor(
    message: string,
    readonly toolCalls: ToolCallRecord[],
    readonly messages: WireMessage[],
    readonly tokensIn: number,
    readonly tokensOut: number,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ToolLoopError'
  }
}

export async function runToolLoop(
  chatCall: ChatCall,
  boundTools: BoundTool[],
  initialMessages: WireMessage[],
  caps: { maxToolTurns: number },
  narrate?: ToolNarration,
): Promise<ToolLoopResult> {
  const messages = [...initialMessages]
  const toolCalls: ToolCallRecord[] = []
  const byName = new Map(boundTools.map(t => [t.def.name, t]))
  const toolsPayload: ChatCallRequest['tools'] = boundTools.map(t => ({
    type: 'function',
    function: { name: t.def.name, description: t.def.description, parameters: t.jsonSchema },
  }))
  let toolTurns = 0
  let tokensIn = 0
  let tokensOut = 0
  let reasoning = ''

  const fail = (msg: string, cause?: unknown): never => {
    throw new ToolLoopError(msg, toolCalls, messages, tokensIn, tokensOut, cause)
  }

  while (true) {
    const forced = toolTurns >= caps.maxToolTurns
    // `toolTurns` only increments once a turn is known to have made calls, so the
    // turn now in flight is the next one.
    const inFlight = toolTurns + 1
    let res: ChatCallResponse
    try {
      res = await chatCall(
        { messages, tools: toolsPayload, ...(forced ? { tool_choice: 'none' as const } : {}) },
        {
          onToolCallStart: () => narrate?.onEvent?.({ type: 'tool_pending', turn: inFlight }),
          onToken: (token, type) => narrate?.onToken?.(token, type, inFlight),
        },
      )
    } catch (err) {
      return fail(`chat call failed mid-loop: ${err instanceof Error ? err.message : String(err)}`, err)
    }
    if (res.usage) {
      tokensIn += res.usage.prompt_tokens
      tokensOut += res.usage.completion_tokens
    }
    const choice = res.choices[0]
    if (!choice?.message) return fail('chat call returned no message')
    const msg = choice.message
    messages.push(msg)
    // Accumulated across turns, not read off the last one: a node that reasons
    // during its tool turns and answers without reasoning would otherwise stream
    // a full thought panel live and persist an empty one (#35).
    if (typeof msg.reasoning === 'string') reasoning += msg.reasoning

    const calls = msg.tool_calls ?? []
    if (forced || calls.length === 0) {
      // #18 finding: Google 200s a hallucinated/undeclared call as
      // finish_reason MALFORMED_FUNCTION_CALL with no tool_calls and no answer.
      // That is a dead-end turn, not a completion.
      if (calls.length === 0 && choice.finish_reason?.includes('MALFORMED_FUNCTION_CALL')) {
        return fail(`model turn dead-ended with finish_reason "${choice.finish_reason}" (no tool_calls, no answer)`)
      }
      const finalText = typeof msg.content === 'string' ? msg.content : ''
      // A model that ignores tool_choice:"none" and answers the forced final with
      // tool_calls and no text has produced nothing usable — surface it, don't
      // report an empty transcript-ending as success.
      if (forced && calls.length > 0 && finalText.trim() === '') {
        return fail(`forced final turn (tool_choice "none") returned tool_calls and no text`)
      }
      return { finalText, reasoning, messages, toolCalls, toolTurns, tokensIn, tokensOut }
    }

    toolTurns++
    const turnText = typeof msg.content === 'string' && msg.content.trim() !== '' ? msg.content : undefined
    for (const [i, call] of calls.entries()) {
      const started = Date.now()
      let args: unknown
      let result: string
      let isError = false
      try {
        args = JSON.parse(call.function.arguments)
      } catch {
        args = call.function.arguments
        isError = true
        result = `Error: malformed JSON in tool arguments: ${call.function.arguments}`
      }
      const tool = byName.get(call.function.name)
      narrate?.onEvent?.({
        type: 'tool_call', turn: toolTurns, name: call.function.name, args,
        ...(tool?.def.activity ? { activity: tool.def.activity } : {}),
      })
      if (!isError) {
        if (!tool) {
          isError = true
          result = `Error: unknown tool "${call.function.name}" — only the declared tools are available.`
        } else {
          try {
            result = await tool.execute(args as Record<string, unknown>)
          } catch (err) {
            isError = true
            result = `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        }
      }
      const latencyMs = Date.now() - started
      narrate?.onEvent?.({ type: 'tool_result', turn: toolTurns, name: call.function.name, result: result!, latencyMs, isError })
      messages.push({ role: 'tool', tool_call_id: call.id, content: result! })
      toolCalls.push({
        turn: toolTurns,
        name: call.function.name,
        args,
        result: result!,
        latencyMs,
        isError,
        ...(i === 0 && turnText !== undefined ? { turnText } : {}),
      })
    }
  }
}
