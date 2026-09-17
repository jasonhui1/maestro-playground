import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta, updateRunMeta, nextStep, latestStepOf, writeAgentLog } from '@/lib/logger'
import { planPromotion, type PromoteRefusal } from '@/lib/promote'
import { streamChainRun, contextOverrides, loadContinuation } from '@/lib/runSession'
import type { RunMeta } from '@/lib/types'

const REFUSAL_STATUS: Record<PromoteRefusal, number> = {
  'unknown-node': 404, 'not-a-proposer': 400, 'no-output': 400, 'bad-turn': 400, 'in-loop': 400, 'past-answered-hold': 409,
}

// Use this on a waiting run: the reply becomes the node's output as a new step,
// its descendants rerun in the same run, and the hold reopens with fresh candidates (#98).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await params
  const body = await req.json().catch(() => ({}))
  const { turn, context } = body ?? {}

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  if (meta.status !== 'waiting') {
    const fork = meta.status === 'complete' || meta.status === 'error' ? '; promoting on a finished run forks it (#99)' : ''
    return NextResponse.json({ error: `Run is ${meta.status}, not waiting${fork}` }, { status: 409 })
  }

  const plan = planPromotion(meta, nodeId, turn)
  if ('refused' in plan) return NextResponse.json({ error: plan.reason }, { status: REFUSAL_STATUS[plan.refused] })
  const sourceStep = latestStepOf(meta.runId, nodeId)
  if (sourceStep === undefined) {
    return NextResponse.json({ error: `Node ${nodeId} has no log in this run` }, { status: 400 })
  }
  const continuation = loadContinuation(meta)
  if ('status' in continuation) return NextResponse.json(continuation.body, { status: continuation.status })

  // No await since the status read: the run is claimed before a second promote or resume can read it.
  // The revision is recorded up front, so a run that fails after it still shows what was promoted.
  updateRunMeta(meta.runId, { status: 'running', agentOutputs: [...plan.marked, plan.revision] })
  writeAgentLog(meta.runId, sourceStep, plan.source)

  return streamChainRun({
    ...continuation,
    runId: meta.runId,
    seedPrompt: meta.seedPrompt,
    paramValue: meta.parameter?.value ?? '',
    context: contextOverrides(context),
    replay: [...plan.kept, plan.revision],
    resumeFrom: { logged: plan.kept.length, nextStep: nextStep(meta.runId) },
    holds: meta.holds,
    superseded: plan.superseded,
  })
}
