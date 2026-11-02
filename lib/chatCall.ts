// The production model adapter; tests stand in tests/helpers/fakeModel.ts (#112, #170).
import OpenAI from 'openai'
import { resolveProvider } from './provider'
import { streamOneTurn } from './modelStream'
import type { ModelFactory } from './model'
import type { ChatCallResponse } from './tools/loop'
import { assembleStreamedResponse } from './tools/streamAssembly'

/** A provider adapter whose client is built on first call, so a request that never calls the model never reads the provider env (#170). */
export function providerModel(): ModelFactory {
  let client: OpenAI | undefined
  const getClient = () => {
    if (!client) {
      const { baseURL, apiKey } = resolveProvider()
      client = new OpenAI({ baseURL, apiKey })
    }
    return client
  }
  return agent => async (req, hooks) => {
    const chunks = await streamOneTurn(() => getClient().chat.completions.create({
      model: agent.model,
      max_tokens: agent.max_tokens ?? 32768,
      // The casts carry provider extras the SDK's types don't know (ADR-0002, #34).
      messages: req.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
      // Omitted rather than sent empty: an agent with no tools must reach the
      // provider as a plain chat turn, and `tools: []` is not universally accepted.
      ...(req.tools.length > 0 ? { tools: req.tools as unknown as OpenAI.Chat.ChatCompletionTool[] } : {}),
      ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
      stream: true,
      // Without `include_usage` a streamed turn reports no tokens (#18).
      stream_options: { include_usage: true },
    }), hooks)
    const res = assembleStreamedResponse(chunks)
    if (res.lossyFields.length > 0) {
      console.warn(`[${agent.name}] streamed turn reconstructed lossily; kept first sighting of: ${res.lossyFields.join(', ')}`)
    }
    return res as ChatCallResponse
  }
}
