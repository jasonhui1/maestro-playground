import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { readRunMeta, updateRunMeta, nextStep } from '@/lib/logger'
import { pinRunVersions, versionKey } from '@/lib/runVersions'
import { validateChain } from '@/lib/chainGraph'
import { chainForResume } from '@/lib/resolveRunChain'
import { answerHold, openHoldOf } from '@/lib/hold'
import { streamChainRun, contextOverrides } from '@/lib/runSession'
import type { RunMeta } from '@/lib/types'

// Resume is replay: every output so far plus the hold's answer, so only what
// follows the hold executes, in the same run folder (#94).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const { direction, context } = body ?? {}
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

  const workspace = loadWorkspace()
  const chain = chainForResume(meta, workspace.chains)
  if (!chain) return NextResponse.json({ error: 'Run has no recorded graph' }, { status: 422 })
  const validation = validateChain(chain, workspace.agents, workspace.chains, workspace.tools, workspace.skills)
  if (!validation.valid) {
    return NextResponse.json({ error: 'Invalid chain', errors: validation.errors }, { status: 400 })
  }

  // No await since the status read: the run is claimed before a second resume can read it.
  const answer = answerHold(hold, direction)
  const holds = (meta.holds ?? []).map(h => (h === hold ? answer.record : h))
  // The answer is recorded up front, so a run that fails after it still shows what was said.
  const agentOutputs = [...meta.agentOutputs, answer.output]
  updateRunMeta(meta.runId, { status: 'running', holds, agentOutputs })

  // Live files run, as a branch does; the pins in meta stay what the run started with (ADR-0011).
  const versionNumber = pinRunVersions(chain, workspace)[versionKey('chain', chain.slug)] ?? 0

  return streamChainRun({
    runId: meta.runId,
    chain,
    workspace,
    seedPrompt: meta.seedPrompt,
    paramValue: meta.parameter?.value ?? '',
    context: contextOverrides(context),
    replay: agentOutputs,
    resumeFrom: { logged: meta.agentOutputs.length, nextStep: nextStep(meta.runId) },
    versionNumber,
    holds,
  })
}
