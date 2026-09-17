import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { runAgent } from '@/lib/runner'
import { readRunMeta, updateRunMeta, writeAgentLog, latestStepOf } from '@/lib/logger'
import { chatTarget, chatTranscript, withTurn } from '@/lib/nodeChat'
import type { ChatMessage, RunMeta } from '@/lib/types'

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
  if ('error' in target) return NextResponse.json({ error: target.error }, { status: target.status })
  const step = latestStepOf(meta.runId, nodeId)
  if (step === undefined) return NextResponse.json({ error: `Node ${nodeId} has no log in this run` }, { status: 400 })
  const agent = loadWorkspace().agents.find(a => a.slug === target.agentSlug)
  if (!agent) return NextResponse.json({ error: `Agent ${target.agentSlug} no longer exists` }, { status: 422 })

  const history = chatTranscript(target.record, message)
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        const result = await runAgent(agent, target.record.systemPrompt, message, {
          history,
          onToken: (token, tokenType) => send({ type: 'token', token, tokenType }),
        })
        if (result.status !== 'success') {
          send({ type: 'error', error: result.error ?? 'chat failed' })
          return
        }
        const reply: ChatMessage = { role: 'assistant', content: result.output, ...(result.thought ? { thought: result.thought } : {}) }

        // Re-read: another turn may have landed while this one streamed.
        const fresh = readRunMeta(meta.runId)
        const current = chatTarget(fresh, nodeId)
        if ('error' in current) throw new Error(current.error)
        const amended = withTurn(current.record, message, reply)
        const agentOutputs = fresh.agentOutputs.map((o, i) => (i === current.index ? amended : o))
        updateRunMeta(meta.runId, { agentOutputs })
        writeAgentLog(meta.runId, step, amended)

        send({ type: 'chat_done', message: reply })
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : String(error) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
