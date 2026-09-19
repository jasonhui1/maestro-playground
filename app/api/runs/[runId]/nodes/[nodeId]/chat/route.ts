import { NextRequest } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { runAgent } from '@/lib/runner'
import { appendTurn, chatSpeaker, chatTranscript, readChatRequest } from '@/lib/nodeChat'
import { loadRunFor } from '@/lib/loadRun'
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

  const meta = loadRunFor(runId, { mustNotBeRunning: true })
  if ('error' in meta) return toResponse(meta)
  const speaker = chatSpeaker(meta, nodeId, loadWorkspace().agents)
  if ('error' in speaker) return toResponse(speaker)
  const { target, agent } = speaker

  return sseResponse(async send => {
    try {
      const result = await runAgent(agent, target.record.systemPrompt, message, {
        history: chatTranscript(target.record, message),
        onToken: (token, tokenType) => send({ type: 'token', token, tokenType }),
      })
      if (result.status !== 'success') {
        send({ type: 'error', error: result.error ?? 'chat failed' })
        return
      }
      const reply: ChatMessage = { role: 'assistant', content: result.output, ...(result.thought ? { thought: result.thought } : {}) }
      appendTurn(meta.runId, nodeId, message, reply)
      send({ type: 'chat_done', message: reply })
    } catch (error) {
      send({ type: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  })
}
