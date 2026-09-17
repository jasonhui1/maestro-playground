import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta, updateRunMeta, nextStep } from '@/lib/logger'
import { answerHold, findCandidate, openHoldOf, type HoldPick } from '@/lib/hold'
import { streamChainRun, contextOverrides, loadContinuation, refusalResponse, type Refusal } from '@/lib/runSession'
import { forkRun } from '@/lib/fork'
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

/** The hold a resume answers: the named one, else the open one, else a finished run's only hold. */
function targetHold(meta: RunMeta, holdId: unknown): HoldRecord | Refusal {
  const holds = meta.holds ?? []
  if (holdId != null) {
    const named = typeof holdId === 'string' ? holds.findLast(h => h.nodeId === holdId) : undefined
    return named ?? { error: `holdId names no hold of this run`, status: 404 }
  }
  const open = meta.status === 'waiting' ? openHoldOf(holds) : undefined
  if (open) return open
  const holdIds = new Set(holds.map(h => h.nodeId))
  if (holdIds.size > 1) return { error: 'The run has several holds; name one with holdId', status: 400 }
  return holds.at(-1) ?? { error: `Run is ${meta.status}, not waiting`, status: 409 }
}

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
  const hold = targetHold(meta, holdId)
  if ('error' in hold) return refusalResponse(hold)

  const pick = pickOf(hold, chosen, custom)
  if (typeof pick === 'string') return NextResponse.json({ error: pick }, { status: 400 })

  if (hold.resolvedAt) {
    const answer = answerHold(hold, direction, pick)
    return forkRun(meta, hold.nodeId, { output: answer.output, hold: answer.record }, context)
  }
  if (meta.status !== 'waiting') {
    return NextResponse.json({ error: `Run is ${meta.status}, not waiting` }, { status: 409 })
  }

  const continuation = loadContinuation(meta)
  if ('error' in continuation) return refusalResponse(continuation)

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
