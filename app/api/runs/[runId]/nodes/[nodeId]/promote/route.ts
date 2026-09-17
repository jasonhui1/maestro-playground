import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta, updateRunMeta, nextStep, latestStepOf, writeAgentLog } from '@/lib/logger'
import { CHAT_REFUSAL_STATUS } from '@/lib/nodeChat'
import { planPromotion, type PromoteRefusal } from '@/lib/promote'
import { forkRun } from '@/lib/fork'
import { withoutNodes } from '@/lib/partialRun'
import { streamChainRun, contextOverrides, loadContinuation, refusalResponse } from '@/lib/runSession'
import type { RunMeta } from '@/lib/types'

const REFUSAL_STATUS: Record<PromoteRefusal, number> = {
  ...CHAT_REFUSAL_STATUS, 'bad-turn': 400, 'in-loop': 400,
}

// Use this: in place on a waiting run, rerunning to the hold (#98);
// a finished run, or one past an answered hold, forks instead (#99).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await params
  const body = await req.json().catch(() => ({}))
  const { turn, context } = body ?? {}
  if (turn != null && !Number.isInteger(turn)) {
    return NextResponse.json({ error: 'turn must be a whole number' }, { status: 400 })
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

  const plan = planPromotion(meta, nodeId, turn ?? undefined)
  if ('refused' in plan) return NextResponse.json({ error: plan.reason }, { status: REFUSAL_STATUS[plan.refused] })
  const sourceStep = latestStepOf(meta.runId, nodeId)
  if (sourceStep === undefined) {
    return NextResponse.json({ error: `Node ${nodeId} has no log in this run` }, { status: 400 })
  }

  if (meta.status !== 'waiting' || plan.forks) {
    const fork = forkRun(meta, nodeId, { output: plan.revision }, context, plan.downstream)
    if ('error' in fork) return refusalResponse(fork)
    // The source keeps its history; only the flag on the promoted reply is new.
    updateRunMeta(meta.runId, { agentOutputs: plan.flaggedOutputs })
    writeAgentLog(meta.runId, sourceStep, plan.source)
    return fork
  }

  const continuation = loadContinuation(meta)
  if ('error' in continuation) return refusalResponse(continuation)

  // No await since the status read: the run is claimed before a second promote or resume can read it.
  // The revision is recorded up front, so a run that fails after it still shows what was promoted.
  const history = plan.flaggedOutputs
  const kept = withoutNodes(history, plan.downstream)
  updateRunMeta(meta.runId, { status: 'running', agentOutputs: [...history, plan.revision] })
  writeAgentLog(meta.runId, sourceStep, plan.source)

  return streamChainRun({
    ...continuation,
    runId: meta.runId,
    seedPrompt: meta.seedPrompt,
    paramValue: meta.parameter?.value ?? '',
    context: contextOverrides(context),
    replay: [...kept, plan.revision],
    resumeFrom: { logged: kept.length, nextStep: nextStep(meta.runId) },
    holds: meta.holds,
    history,
  })
}
