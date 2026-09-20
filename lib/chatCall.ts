// The provider adapter behind the loop's one seam. It is a module of its own so
// that a route test can replace the model — and only the model — with a scripted
// fake, leaving runAgent, the loop and cost accounting real (#112).
import OpenAI from 'openai'
import { AgentDef } from './types'
import { resolveProvider } from './provider'
import { streamOneTurn } from './modelStream'
import type { ChatCall, ChatCallResponse } from './tools/loop'
import { assembleStreamedResponse } from './tools/streamAssembly'

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    const { baseURL, apiKey } = resolveProvider()
    _client = new OpenAI({ baseURL, apiKey })
  }
  return _client
}

// Wires the real client into the loop's one seam. Streamed (#34): the chunk
// sequence is reassembled into one settled response before it reaches the loop,
// which still sees whole messages. `include_usage` is what makes a streamed turn
// report tokens at all — without it every tool node costs a silent zero.
// The casts are load-bearing: the SDK's types don't know the provider extras
// (`reasoning`, `reasoning_details`, `extra_content`) that wire-truth requires we
// echo, and #18 verified they survive the client's serialization regardless.
export function createChatCall(agent: AgentDef): ChatCall {
  return async (req, hooks) => {
    const chunks = await streamOneTurn(() => getClient().chat.completions.create({
      model: agent.model,
      max_tokens: agent.max_tokens ?? 32768,
      messages: req.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
      // Omitted rather than sent empty: an agent with no tools must reach the
      // provider as a plain chat turn, and `tools: []` is not universally accepted.
      ...(req.tools.length > 0 ? { tools: req.tools as unknown as OpenAI.Chat.ChatCompletionTool[] } : {}),
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
