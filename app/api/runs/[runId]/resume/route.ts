import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta, updateRunMeta, nextStep } from '@/lib/logger'
import { answerHold, findCandidate, openHoldOf, type HoldPick } from '@/lib/hold'
import { streamChainRun, contextOverrides, loadContinuation } from '@/lib/runSession'
import type { HoldRecord, RunMeta } from '@/lib/types'

/** The body's pick, or why it is refused. Neither field given is no pick (#96). */
function pickOf(hold: HoldRecord, chosen: unknown, custom: unknown): HoldPick | undefined | string {
  if (chosen != null && custom != null) return 'send chosen or custom, not both'
  if (custom != null) {
    return typeof custom === 'string' && custom.trim() ? { custom: custom.trim() } : 'custom must be non-empty text'
  }
  if (chosen == null) return undefined
  const candidate = typeof chosen === 'string' ? findCandidate(hold, chosen) : undefined
  return candidate ? { candidate } : `chosen names no candidate of hold ${hold.nodeId}`
}

// Resume is replay: every output so far plus the hold's answer, so only what
// follows the hold executes, in the same run folder (#94).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const { direction, chosen, custom, context } = body ?? {}
  if (typeof direction !== 'string' || !direction.trim()) {
    return NextResponse.json({ error: 'direction is required' }, { status: 400 })
  }

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  const hold = openHoldOf(meta.holds)
  if (meta.status !== 'waiting' || !hold) {
    return NextResponse.json({ error: `Run is ${meta.status}, not waiting` }, { status: 409 })
  }

  const pick = pickOf(hold, chosen, custom)
  if (typeof pick === 'string') return NextResponse.json({ error: pick }, { status: 400 })

  const continuation = loadContinuation(meta)
  if ('status' in continuation) return NextResponse.json(continuation.body, { status: continuation.status })

  // No await since the status read: the run is claimed before a second resume can read it.
  const answer = answerHold(hold, direction, pick)
  const holds = (meta.holds ?? []).map(h => (h === hold ? answer.record : h))
  // The answer is recorded up front, so a run that fails after it still shows what was said.
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
