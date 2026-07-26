import OpenAI from 'openai'
import { AgentDef, AgentOutput, ChatMessage } from './types'
import { resolveRefs } from './resolver'
import { calcCost } from './pricing'
import { injectSkills } from './prompt'
import { runToolLoop, ToolLoopError, ChatCall, ChatCallHooks, ChatCallResponse, WireMessage } from './tools/loop'
import type { ToolEventSink, ToolNarration } from './tools/events'
import { assembleStreamedResponse, StreamChunk } from './tools/streamAssembly'
import type { BoundTool } from './tools/registry'

export const DEFAULT_MAX_TOOL_TURNS = 8

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    // Both normalizations are #18 findings that cost an afternoon each: a CRLF
    // .env.local leaves a trailing \r on every value, and a trailing slash on the
    // base URL yields //chat/completions, which Google 404s. scripts/derisk was
    // hardened at the time; the app was not.
    const baseURL = (process.env.AI_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
    _client = new OpenAI({ baseURL, apiKey: process.env.AI_API_KEY?.trim() })
  }
  return _client
}

// Retry policy for model calls. 429 and 5xx only — a 400 is a config error and
// must fail loudly on the first try. #18's "intermittent 400s" turned out to be
// the two env footguns above; retrying them would only have hidden them longer.
export function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' && (status === 429 || status >= 500)
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const delayMs = opts.delayMs ?? 500
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransient(err) || i >= attempts - 1) throw err
      await sleep(delayMs * 2 ** i)
    }
  }
}

export interface ThoughtSplitter {
  push(delta: string): void
  // Releases text held back as a possible partial tag. Callers that stop feeding
  // must call this or that text is lost.
  flush(): void
  result(): { output: string; thought: string }
}

// The one implementation of the <thought> rule — fed a delta at a time by the
// streaming paths, whole by splitThought. An unterminated tag swallows the rest.
export function createThoughtSplitter(
  onToken?: (token: string, type: 'thought' | 'output') => void,
): ThoughtSplitter {
  let output = ''
  let thought = ''
  let isThinking = false
  let buffer = ''

  const emit = (text: string) => {
    if (!text) return
    if (isThinking) { thought += text; onToken?.(text, 'thought') }
    else { output += text; onToken?.(text, 'output') }
  }

  return {
    push(delta) {
      if (!delta) return
      buffer += delta
      for (;;) {
        const tag = isThinking ? '</thought>' : '<thought>'
        const at = buffer.indexOf(tag)
        if (at === -1) break
        emit(buffer.slice(0, at))
        isThinking = !isThinking
        buffer = buffer.slice(at + tag.length)
      }
      // Hold back a trailing prefix of the tag we are hunting: it may complete
      // on the next delta.
      const tag = isThinking ? '</thought>' : '<thought>'
      let held = 0
      for (let i = tag.length - 1; i > 0; i--) {
        if (buffer.endsWith(tag.slice(0, i))) { held = i; break }
      }
      emit(buffer.slice(0, buffer.length - held))
      buffer = buffer.slice(buffer.length - held)
    },
    flush() {
      emit(buffer)
      buffer = ''
    },
    result: () => ({ output, thought }),
  }
}

export function splitThought(text: string): { output: string; thought: string } {
  const s = createThoughtSplitter()
  s.push(text)
  s.flush()
  return s.result()
}

// Turns a chunk sequence into stream facts for the loop's hooks. Kept out of
// assembleStreamedResponse so the assembler stays pure and replay-testable (#34).
export function createStreamNarrator(hooks?: ChatCallHooks) {
  const splitter = createThoughtSplitter(hooks?.onToken)
  let reasoning = ''
  let announced = false
  return {
    push(chunk: StreamChunk) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta) return
      if (!announced && (delta.tool_calls?.length ?? 0) > 0) {
        announced = true
        hooks?.onToolCallStart?.()
      }
      splitter.push(delta.content ?? '')
      // A native reasoning field bypasses the splitter — it holds no tags (#35).
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        reasoning += delta.reasoning
        hooks?.onToken?.(delta.reasoning, 'thought')
      }
    },
    flush() { splitter.flush() },
    result: () => ({ ...splitter.result(), reasoning }),
  }
}

// Wires the real client into the loop's one seam. Streamed (#34): the chunk
// sequence is reassembled into one settled response before it reaches the loop,
// which still sees whole messages. `include_usage` is what makes a streamed turn
// report tokens at all — without it every tool node costs a silent zero.
// The casts are load-bearing: the SDK's types don't know the provider extras
// (`reasoning`, `reasoning_details`, `extra_content`) that wire-truth requires we
// echo, and #18 verified they survive the client's serialization regardless.
// The retry spans opening AND draining: a turn that dies mid-body is as transient
// as one that never opened, and the loop's contract is one chatCall = one settled
// turn. Only the first attempt narrates — a retry would replay text the client has
// already seen and announce the same turn's tool call twice (#35).
export async function streamOneTurn(
  open: () => Promise<AsyncIterable<unknown>>,
  hooks?: ChatCallHooks,
  retry?: Parameters<typeof withRetry>[1],
): Promise<StreamChunk[]> {
  const narrator = createStreamNarrator(hooks)
  let attempt = 0
  return withRetry(async () => {
    const narrating = attempt++ === 0
    const stream = await open()
    const received: StreamChunk[] = []
    for await (const chunk of stream) {
      const typed = chunk as StreamChunk
      received.push(typed)
      if (narrating) narrator.push(typed)
    }
    if (narrating) narrator.flush()
    return received
  }, retry)
}

function createChatCall(agent: AgentDef): ChatCall {
  return async (req, hooks) => {
    const chunks = await streamOneTurn(() => getClient().chat.completions.create({
      model: agent.model,
      max_tokens: agent.max_tokens ?? 32768,
      messages: req.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: req.tools as unknown as OpenAI.Chat.ChatCompletionTool[],
      ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }), hooks)
    const res = assembleStreamedResponse(chunks)
    if (res.lossyFields.length > 0) {
      console.warn(`[${agent.name}] streamed turn reconstructed lossily; kept first sighting of: ${res.lossyFields.join(', ')}`)
    }
    return res as ChatCallResponse
  }
}

async function runAgentWithTools(
  agent: AgentDef,
  resolvedSystemPrompt: string,
  userMessage: string,
  boundTools: BoundTool[],
  chatCall: ChatCall,
  options: { history?: ChatMessage[]; narrate?: ToolNarration } = {},
): Promise<AgentOutput> {
  const { history, narrate } = options
  const start = Date.now()
  const initial: WireMessage[] = history && history.length > 0
    ? history.map(m => ({ role: m.role, content: m.content }) as WireMessage)
    : [
        { role: 'system', content: resolvedSystemPrompt },
        { role: 'user', content: userMessage },
      ]
  const base = {
    agentName: agent.name,
    input: userMessage,
    systemPrompt: resolvedSystemPrompt,
    model: agent.model,
    timestamp: new Date().toISOString(),
  }

  try {
    const res = await runToolLoop(chatCall, boundTools, initial, {
      maxToolTurns: agent.max_tool_turns ?? DEFAULT_MAX_TOOL_TURNS,
    }, narrate)
    const { output, thought } = splitThought(res.finalText)
    return {
      ...base,
      output,
      thought: thought || res.reasoning,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: calcCost(agent.model, res.tokensIn, res.tokensOut),
      latencyMs: Date.now() - start,
      status: 'success',
      toolCalls: res.toolCalls,
      toolTurns: res.toolTurns,
    }
  } catch (err: unknown) {
    // A loop that died mid-flight still spent tokens and still did real work. Both
    // are reported: the transcript-so-far rides along so the log shows how far it
    // got, and cost reflects what was actually burned rather than a tidy zero.
    const partial = err instanceof ToolLoopError ? err : null
    const tokensIn = partial?.tokensIn ?? 0
    const tokensOut = partial?.tokensOut ?? 0
    return {
      ...base,
      output: '',
      tokensIn,
      tokensOut,
      costUsd: calcCost(agent.model, tokensIn, tokensOut),
      latencyMs: Date.now() - start,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      ...(partial ? {
        toolCalls: partial.toolCalls,
        toolTurns: partial.toolCalls.reduce((max, c) => Math.max(max, c.turn), 0),
      } : {}),
    }
  }
}

export interface RunAgentOptions {
  onToken?: (token: string, type?: 'thought' | 'output', turn?: number) => void
  history?: ChatMessage[]
  boundTools?: BoundTool[]
  chatCall?: ChatCall   // test seam; production wires createChatCall(agent)
  onToolEvent?: ToolEventSink
}

export async function runAgent(
  agent: AgentDef,
  resolvedSystemPrompt: string,
  userMessage: string,
  options: RunAgentOptions = {},
): Promise<AgentOutput> {
  const { onToken, history, boundTools, chatCall, onToolEvent } = options
  if (boundTools && boundTools.length > 0) {
    return runAgentWithTools(
      agent, resolvedSystemPrompt, userMessage, boundTools,
      chatCall ?? createChatCall(agent),
      { history, narrate: { onEvent: onToolEvent, onToken } },
    )
  }

  const start = Date.now()
  const narrator = createStreamNarrator({ onToken })
  let tokensIn = 0
  let tokensOut = 0

  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = history && history.length > 0
      ? history as OpenAI.Chat.ChatCompletionMessageParam[]
      : [
          { role: 'system', content: resolvedSystemPrompt },
          { role: 'user', content: userMessage }
        ]

    const stream = await getClient().chat.completions.create({
      model: agent.model,
      max_tokens: agent.max_tokens ?? 32768,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    })

    for await (const chunk of stream) {
      narrator.push(chunk as unknown as StreamChunk)
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens
        tokensOut = chunk.usage.completion_tokens
      }
    }
    narrator.flush()
    const { output, thought, reasoning } = narrator.result()

    return {
      agentName: agent.name,
      input: userMessage,
      systemPrompt: resolvedSystemPrompt,
      output,
      thought: thought || reasoning,
      tokensIn,
      tokensOut,
      costUsd: calcCost(agent.model, tokensIn, tokensOut),
      latencyMs: Date.now() - start,
      model: agent.model,
      timestamp: new Date().toISOString(),
      status: 'success',
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return {
      agentName: agent.name,
      input: userMessage,
      systemPrompt: resolvedSystemPrompt,
      output: '',
      tokensIn,
      tokensOut,
      costUsd: 0,
      latencyMs: Date.now() - start,
      model: agent.model,
      timestamp: new Date().toISOString(),
      status: 'error',
      error: errorMessage,
    }
  }
}

export async function buildSystemPrompt(
  agent: AgentDef,
  allSkills: import('./types').SkillDef[],
  previousOutputs: AgentOutput[],
  workspacePath: string,
  userInput: string,
): Promise<string> {
  const resolvedBody = resolveRefs(
    agent.systemPrompt,
    previousOutputs,
    workspacePath,
    userInput,
  )

  return injectSkills(agent, allSkills, resolvedBody)
}
