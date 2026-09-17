import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { runAgent } from '@/lib/runner'
import { readRunMeta, latestStepOf } from '@/lib/logger'
import { appendTurn, chatTarget, chatTranscript, type ChatRefusal } from '@/lib/nodeChat'
import { sseResponse } from '@/lib/sse'
import type { ChatMessage, RunMeta } from '@/lib/types'

const REFUSAL_STATUS: Record<ChatRefusal, number> = { 'unknown-node': 404, 'not-a-proposer': 400, 'no-output': 400 }

// A node's conversation continues its own transcript and lives in its log (#97).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await params
  const body = await req.json().catch(() => ({}))
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  // A running stretch rewrites agentOutputs when it ends, which would drop the turn.
  if (meta.status === 'running') {
    return NextResponse.json({ error: 'Run is running; chat once it waits or ends' }, { status: 409 })
  }

  const target = chatTarget(meta, nodeId)
  if ('refused' in target) return NextResponse.json({ error: target.reason }, { status: REFUSAL_STATUS[target.refused] })
  if (latestStepOf(meta.runId, nodeId) === undefined) {
    return NextResponse.json({ error: `Node ${nodeId} has no log in this run` }, { status: 400 })
  }
  const live = loadWorkspace().agents.find(a => a.slug === target.agentSlug)
  if (!live) return NextResponse.json({ error: `Agent ${target.agentSlug} no longer exists` }, { status: 422 })
  // The reply comes from the model that wrote the output, not whatever the file names now.
  const agent = target.record.model ? { ...live, model: target.record.model } : live

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
