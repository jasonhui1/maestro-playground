// The provider adapter behind the loop's one seam, alone in this module so a
// test can replace the model and nothing else (#112).
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

// `include_usage` is what makes a streamed turn report tokens at all; the casts
// carry provider extras the SDK's types don't know (ADR-0002, #34, #18).
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
