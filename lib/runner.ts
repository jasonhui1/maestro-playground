import OpenAI from 'openai'
import { AgentDef, AgentOutput, ChatMessage } from './types'
import { resolveRefs } from './resolver'
import { calcCost } from './pricing'
import { injectSkills } from './prompt'
import { runToolLoop, ToolLoopError, ChatCall, ChatCallResponse, WireMessage } from './tools/loop'
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

// The streaming path extracts <thought> incrementally as deltas arrive; the tool
// loop gets whole messages, so it splits after the fact. Same semantics, including
// the sticky one: an unterminated <thought> swallows the rest of the text.
export function splitThought(text: string): { output: string; thought: string } {
  let output = ''
  let thought = ''
  let rest = text
  for (;;) {
    const start = rest.indexOf('<thought>')
    if (start === -1) { output += rest; break }
    output += rest.slice(0, start)
    rest = rest.slice(start + '<thought>'.length)
    const end = rest.indexOf('</thought>')
    if (end === -1) { thought += rest; break }
    thought += rest.slice(0, end)
    rest = rest.slice(end + '</thought>'.length)
  }
  return { output, thought }
}

// Wires the real client into the loop's one seam. Streamed (#34): the chunk
// sequence is reassembled into one settled response before it reaches the loop,
// which still sees whole messages. `include_usage` is what makes a streamed turn
// report tokens at all — without it every tool node costs a silent zero.
// The casts are load-bearing: the SDK's types don't know the provider extras
// (`reasoning`, `reasoning_details`, `extra_content`) that wire-truth requires we
// echo, and #18 verified they survive the client's serialization regardless.
function createChatCall(agent: AgentDef): ChatCall {
  return async (req) => {
    // The retry spans opening AND draining the stream: a turn that dies mid-body
    // is as transient as one that never opened, and the loop's contract is that
    // one chatCall is one settled turn. Chunks from the dead attempt are dropped.
    const chunks = await withRetry(async () => {
      const stream = await getClient().chat.completions.create({
        model: agent.model,
        max_tokens: agent.max_tokens ?? 32768,
        messages: req.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: req.tools as unknown as OpenAI.Chat.ChatCompletionTool[],
        ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
        stream: true,
        stream_options: { include_usage: true },
      })
      const received: StreamChunk[] = []
      for await (const chunk of stream) received.push(chunk as unknown as StreamChunk)
      return received
    })
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
  history: ChatMessage[] | undefined,
  chatCall: ChatCall,
): Promise<AgentOutput> {
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
    })
    const { output, thought } = splitThought(res.finalText)
    return {
      ...base,
      output,
      thought,
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

export async function runAgent(
  agent: AgentDef,
  resolvedSystemPrompt: string,
  userMessage: string,
  onToken?: (token: string, type?: 'thought' | 'output') => void,
  history?: ChatMessage[],
  boundTools?: BoundTool[],
  chatCall?: ChatCall,   // test seam; production wires createChatCall(agent)
): Promise<AgentOutput> {
  if (boundTools && boundTools.length > 0) {
    return runAgentWithTools(
      agent, resolvedSystemPrompt, userMessage, boundTools, history,
      chatCall ?? createChatCall(agent),
    )
  }

  const start = Date.now()
  let output = ''
  let thought = ''
  let isThinking = false
  let tokensIn = 0
  let tokensOut = 0

  // Buffer to catch tags that are split across chunks
  let buffer = ''

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
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        buffer += content

        let changed = true
        while (changed) {
          changed = false
          if (!isThinking) {
            const thoughtStart = buffer.indexOf('<thought>')
            if (thoughtStart !== -1) {
              const preThought = buffer.slice(0, thoughtStart)
              if (preThought) {
                output += preThought
                onToken?.(preThought, 'output')
              }
              isThinking = true
              buffer = buffer.slice(thoughtStart + '<thought>'.length)
              changed = true
            }
          } else {
            const thoughtEnd = buffer.indexOf('</thought>')
            if (thoughtEnd !== -1) {
              const preEnd = buffer.slice(0, thoughtEnd)
              if (preEnd) {
                thought += preEnd
                onToken?.(preEnd, 'thought')
              }
              isThinking = false
              buffer = buffer.slice(thoughtEnd + '</thought>'.length)
              changed = true
            }
          }
        }

        // Handle partial tags at the end of the buffer
        const currentTag = isThinking ? '</thought>' : '<thought>'
        let partialMatchIndex = -1
        
        for (let i = 1; i < currentTag.length; i++) {
          if (buffer.endsWith(currentTag.slice(0, i))) {
            partialMatchIndex = buffer.length - i
            break
          }
        }

        if (partialMatchIndex !== -1) {
          const readyText = buffer.slice(0, partialMatchIndex)
          if (readyText) {
            if (isThinking) {
              thought += readyText
              onToken?.(readyText, 'thought')
            } else {
              output += readyText
              onToken?.(readyText, 'output')
            }
          }
          buffer = buffer.slice(partialMatchIndex)
        } else {
          if (buffer.length > 0) {
            if (isThinking) {
              thought += buffer
              onToken?.(buffer, 'thought')
            } else {
              output += buffer
              onToken?.(buffer, 'output')
            }
            buffer = ''
          }
        }
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens
        tokensOut = chunk.usage.completion_tokens
      }
    }

    return {
      agentName: agent.name,
      input: userMessage,
      systemPrompt: resolvedSystemPrompt,
      output,
      thought,
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
