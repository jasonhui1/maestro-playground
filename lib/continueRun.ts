import { answerHold, readPick, selectHold, type AnswerRequest } from './hold'
import { planPromotion, type PromoteRequest } from './promote'
import { forkRun, planFork, type ForkRequest } from './fork'
import { runLog } from './partialRun'
import { nextStep, updateRunMeta, writeAgentLog } from './logger'
import { loggedStep } from './nodeChat'
import { loadRunFor } from './loadRun'
import { conflict, toResponse } from './refusal'
import { contextOverrides, loadContinuation, streamChainRun, type LiveWorkspace } from './runSession'
import type { AgentOutput, HoldRecord, Refusal, RunMeta } from './types'

/** What a continuation does to a run: answer a hold (resume), promote a reply, or fork. */
export type ContinuePlan =
  | { answer: AnswerRequest }
  | { promote: PromoteRequest }
  | { fork: ForkRequest }

/**
 * Continues run `runId` by `plan`, in place or as a fork (#99, #107); refusals come back as JSON.
 * A running run is refused (#104). In place, earlier records replay as the objects in
 * `meta.agentOutputs` and keep their logs (ADR-0011).
 */
export function continueRun(
  workspace: LiveWorkspace,
  runId: string,
  plan: ContinuePlan,
  requestContext?: unknown,
): Response {
  const meta = loadRunFor(runId, { mustNotBeRunning: true })
  if ('error' in meta) return toResponse(meta)
  const context = contextOverrides(requestContext)
  const res = 'answer' in plan ? answer(workspace, meta, plan.answer, context)
    : 'promote' in plan ? promote(workspace, meta, plan.promote, context)
    : fork(workspace, meta, plan.fork, context)
  return 'error' in res ? toResponse(res) : res
}

function answer(
  workspace: LiveWorkspace, meta: RunMeta,
  { holdId, direction, chosen, custom }: AnswerRequest,
  context: Record<string, string>,
): Response | Refusal {
  const hold = selectHold(meta, holdId)
  if ('error' in hold) return hold
  const pick = readPick(hold, chosen, custom)
  if (pick && 'error' in pick) return pick

  const answered = answerHold(meta.holds ?? [], hold, direction, pick)
  if (answered.mode === 'fork') {
    return forkRun(workspace, meta, { anchors: [hold.nodeId], outputs: [answered.output], hold: answered.record }, context)
  }
  if (meta.status !== 'waiting') return conflict(`Run is ${meta.status}, not waiting`)

  // The answer is recorded up front, so a run that fails after it still shows what was said.
  const { holds, output } = answered
  return inPlace(workspace, meta, {
    logged: meta.agentOutputs, fresh: output, holds,
    metaUpdate: { holds, agentOutputs: [...meta.agentOutputs, output] },
  }, context)
}

function promote(
  workspace: LiveWorkspace, meta: RunMeta,
  { nodeId, turn }: PromoteRequest,
  context: Record<string, string>,
): Response | Refusal {
  const plan = planPromotion(meta, nodeId, turn)
  if ('error' in plan) return plan
  const sourceStep = loggedStep(meta.runId, nodeId)
  if (typeof sourceStep !== 'number') return sourceStep

  if (meta.status !== 'waiting' || plan.forks) {
    const res = forkRun(workspace, meta, { anchors: [nodeId], outputs: [plan.revision] }, context)
    if ('error' in res) return res
    // The source keeps its history; only the flag on the promoted reply is new.
    updateRunMeta(meta.runId, { agentOutputs: plan.flaggedOutputs })
    writeAgentLog(meta.runId, sourceStep, plan.source)
    return res
  }

  // The revision is recorded up front, so a run that fails after it still shows what was promoted.
  const history = plan.flaggedOutputs
  const { replay: kept } = runLog({ agentOutputs: history, graph: meta.graph, holds: meta.holds }).replayFor([nodeId])
  return inPlace(workspace, meta, {
    logged: kept, fresh: plan.revision, holds: meta.holds, history,
    metaUpdate: { agentOutputs: [...history, plan.revision] },
    rewriteLog: { step: sourceStep, output: plan.source },
  }, context)
}

function fork(workspace: LiveWorkspace, meta: RunMeta, request: ForkRequest, context: Record<string, string>): Response | Refusal {
  const plan = planFork(meta, request)
  return 'error' in plan ? plan : forkRun(workspace, meta, plan, context)
}

/** A stretch in the run's own folder: `logged` replay as they are, `fresh` is logged first. */
function inPlace(
  workspace: LiveWorkspace,
  meta: RunMeta,
  stretch: {
    logged: AgentOutput[]
    fresh: AgentOutput
    holds?: HoldRecord[]
    /** Every record the run holds before this stretch, when some of them rerun. */
    history?: AgentOutput[]
    /** What meta.json records as the stretch starts. */
    metaUpdate: Partial<RunMeta>
    /** An earlier step whose log is rewritten as the stretch starts. */
    rewriteLog?: { step: number; output: AgentOutput }
  },
  context: Record<string, string>,
): Response | Refusal {
  const continuation = loadContinuation(workspace, meta)
  if ('error' in continuation) return continuation
  const { chain, workspace: defs, versionNumber } = continuation

  // No await since the caller's status read: the run is claimed before a second continuation can read it.
  updateRunMeta(meta.runId, { status: 'running', ...stretch.metaUpdate })
  if (stretch.rewriteLog) writeAgentLog(meta.runId, stretch.rewriteLog.step, stretch.rewriteLog.output)
  return streamChainRun({
    chain,
    workspace: defs,
    versionNumber,
    runId: meta.runId,
    seedPrompt: meta.seedPrompt,
    paramValue: meta.parameter?.value ?? '',
    context,
    replay: { logged: stretch.logged, fresh: [stretch.fresh] },
    firstStep: nextStep(meta.runId),
    holds: stretch.holds,
    history: stretch.history,
  })
}
