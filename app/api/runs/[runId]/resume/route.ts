import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta, updateRunMeta, nextStep } from '@/lib/logger'
import { answerHold, readPick, selectHold } from '@/lib/hold'
import { streamChainRun, contextOverrides, loadContinuation, refusalResponse } from '@/lib/runSession'
import { forkRun } from '@/lib/fork'
import type { RunMeta } from '@/lib/types'

// Resume is replay, in the same run folder, of every output plus the hold's answer (#94);
// re-answering an answered hold forks instead (#99).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const { direction, chosen, custom, context, holdId } = body ?? {}
  if (typeof direction !== 'string' || !direction.trim()) {
    return NextResponse.json({ error: 'direction is required' }, { status: 400 })
  }

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  if (meta.status === 'running') {
    return NextResponse.json({ error: 'Run is running' }, { status: 409 })
  }
  const hold = selectHold(meta, holdId)
  if ('error' in hold) return refusalResponse(hold)

  const pick = readPick(hold, chosen, custom)
  if (pick && 'error' in pick) return refusalResponse(pick)

  const answer = answerHold(meta.holds ?? [], hold, direction, pick)
  if (answer.mode === 'fork') {
    const fork = forkRun(meta, { anchors: [hold.nodeId], outputs: [answer.output], hold: answer.record, context })
    return 'error' in fork ? refusalResponse(fork) : fork
  }
  if (meta.status !== 'waiting') {
    return NextResponse.json({ error: `Run is ${meta.status}, not waiting` }, { status: 409 })
  }

  const continuation = loadContinuation(meta)
  if ('error' in continuation) return refusalResponse(continuation)

  // No await since the status read: the run is claimed before a second resume can read it.
  // The answer is recorded up front, so a run that fails after it still shows what was said.
  const { holds } = answer
  const agentOutputs = [...meta.agentOutputs, answer.output]
  updateRunMeta(meta.runId, { status: 'running', holds, agentOutputs })

  return streamChainRun({
    ...continuation,
    runId: meta.runId,
    seedPrompt: meta.seedPrompt,
    paramValue: meta.parameter?.value ?? '',
    context: contextOverrides(context),
    replay: agentOutputs,
    resumeFrom: { logged: meta.agentOutputs.length, nextStep: nextStep(meta.runId) },
    holds,
  })
}
