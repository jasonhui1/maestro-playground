import { NextRequest } from 'next/server'
import { runAgentTurn } from '@/lib/agentTurn'
import { runToolContext } from '@/lib/tools/context'
import { appendTurn, chatSpeaker, chatTranscript, readChatRequest } from '@/lib/nodeChat'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { toResponse } from '@/lib/refusal'
import { sseResponse } from '@/lib/sse'
import type { ChatMessage } from '@/lib/types'

// A node's conversation continues its own transcript and lives in its log (#97).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await params
  const body = await req.json().catch(() => ({}))
  const chat = readChatRequest(body ?? {})
  if ('error' in chat) return toResponse(chat)
  const { message } = chat

  const ws = requestWorkspace()
  const { runs } = ws
  const meta = loadRunFor(runs, runId, { mustNotBeRunning: true })
  if ('error' in meta) return toResponse(meta)
  const { agents, tools } = ws.definitions()
  const speaker = chatSpeaker(runs, meta, nodeId, agents)
  if ('error' in speaker) return toResponse(speaker)
  const { target, agent } = speaker

  return sseResponse(async send => {
    try {
      const result = await runAgentTurn(ws.model, {
        agent, systemPrompt: target.record.systemPrompt, input: message,
        history: chatTranscript(target.record, message),
        // A node keeps the tools it ran with when a human follows up (#112).
        tools: { defs: tools, context: { ...runToolContext(ws, meta.runId), fixedParts: target.record.fixedParts } },
        onToken: (token, tokenType) => send({ type: 'token', token, tokenType }),
        onToolEvent: event => send(event),
      })
      if (result.status !== 'success') {
        send({ type: 'error', error: result.error ?? 'chat failed' })
        return
      }
      const reply: ChatMessage = { role: 'assistant', content: result.output, ...(result.thought ? { thought: result.thought } : {}) }
      appendTurn(runs, meta.runId, nodeId, message, reply)
      send({ type: 'chat_done', message: reply })
    } catch (error) {
      send({ type: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  })
}
