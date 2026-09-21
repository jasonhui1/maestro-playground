import { answerHold, readPick, selectHold, type AnswerRequest } from './hold'
import { planPromotion, type PromoteRequest } from './promote'
import { forkRun, planFork, type ForkRequest } from './fork'
import { runLog } from './partialRun'
import { loggedStep } from './nodeChat'
import { loadRunFor } from './loadRun'
import { conflict, toResponse } from './refusal'
import type { Workspace } from './runFolders'
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
  ws: Workspace,
  runId: string,
  plan: ContinuePlan,
  requestContext?: unknown,
): Response {
  const meta = loadRunFor(ws.runs, runId, { mustNotBeRunning: true })
  if ('error' in meta) return toResponse(meta)
  const context = contextOverrides(requestContext)
  const workspace = ws.definitions()
  const res = 'answer' in plan ? answer(ws, workspace, meta, plan.answer, context)
    : 'promote' in plan ? promote(ws, workspace, meta, plan.promote, context)
    : fork(ws, workspace, meta, plan.fork, context)
  return 'error' in res ? toResponse(res) : res
}

import { resolveContinuationModelOverride } from './pricing'

function answer(
  ws: Workspace, workspace: LiveWorkspace, meta: RunMeta,
  { holdId, direction, chosen, custom, modelOverride }: AnswerRequest,
  context: Record<string, string>,
): Response | Refusal {
  const hold = selectHold(meta, holdId)
  if ('error' in hold) return hold
  const pick = readPick(hold, chosen, custom)
  if (pick && 'error' in pick) return pick

  // #128: Omission inherits source override; null clears; nonempty string replaces.
  const effectiveOverride = resolveContinuationModelOverride(meta.modelOverride, modelOverride)

  const answered = answerHold(meta.holds ?? [], hold, direction, pick)
  if (answered.mode === 'fork') {
    return forkRun(ws, workspace, meta, { anchors: [hold.nodeId], outputs: [answered.output], hold: answered.record, modelOverride: effectiveOverride }, context)
  }
  if (meta.status !== 'waiting') return conflict(`Run is ${meta.status}, not waiting`)

  // The answer is recorded up front, so a run that fails after it still shows what was said.
  const { holds, output } = answered
  const metaUpdate: Partial<RunMeta> = {
    holds,
    agentOutputs: [...meta.agentOutputs, output],
    ...(modelOverride === null ? { modelOverride: undefined } : effectiveOverride ? { modelOverride: effectiveOverride } : {}),
  }
  return inPlace(ws, workspace, meta, {
    logged: meta.agentOutputs, fresh: output, holds,
    modelOverride: effectiveOverride,
    metaUpdate,
  }, context)
}

function promote(
  ws: Workspace, workspace: LiveWorkspace, meta: RunMeta,
  { nodeId, turn }: PromoteRequest,
  context: Record<string, string>,
): Response | Refusal {
  const plan = planPromotion(meta, nodeId, turn)
  if ('error' in plan) return plan
  const sourceStep = loggedStep(ws.runs, meta.runId, nodeId)
  if (typeof sourceStep !== 'number') return sourceStep

  if (meta.status !== 'waiting' || plan.forks) {
    const res = forkRun(ws, workspace, meta, { anchors: [nodeId], outputs: [plan.revision] }, context)
    if ('error' in res) return res
    // The source keeps its history; only the flag on the promoted reply is new.
    ws.runs.update(meta.runId, { agentOutputs: plan.flaggedOutputs })
    ws.runs.writeStep(meta.runId, sourceStep, plan.source)
    return res
  }

  // The revision is recorded up front, so a run that fails after it still shows what was promoted.
  const history = plan.flaggedOutputs
  const { replay: kept } = runLog({ agentOutputs: history, graph: meta.graph, holds: meta.holds }).replayFor([nodeId])
  return inPlace(ws, workspace, meta, {
    logged: kept, fresh: plan.revision, holds: meta.holds, history,
    metaUpdate: { agentOutputs: [...history, plan.revision] },
    rewriteLog: { step: sourceStep, output: plan.source },
  }, context)
}

function fork(
  ws: Workspace, workspace: LiveWorkspace, meta: RunMeta, request: ForkRequest, context: Record<string, string>,
): Response | Refusal {
  const plan = planFork(meta, request)
  return 'error' in plan ? plan : forkRun(ws, workspace, meta, plan, context)
}

/** A stretch in the run's own folder: `logged` replay as they are, `fresh` is logged first. */
function inPlace(
  ws: Workspace,
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
    /** Model override active for this stretch (#128). */
    modelOverride?: string
  },
  context: Record<string, string>,
): Response | Refusal {
  const continuation = loadContinuation(ws.root, workspace, meta)
  if ('error' in continuation) return continuation
  const { chain, workspace: defs, versionNumber } = continuation

  if (!ws.runs.claim(meta.runId, stretch.metaUpdate)) return conflict('Run is running')
  if (stretch.rewriteLog) ws.runs.writeStep(meta.runId, stretch.rewriteLog.step, stretch.rewriteLog.output)
  return streamChainRun({
    ws,
    chain,
    workspace: defs,
    versionNumber,
    runId: meta.runId,
    seedPrompt: meta.seedPrompt,
    paramValue: meta.parameter?.value ?? '',
    context,
    modelOverride: stretch.modelOverride ?? meta.modelOverride,
    replay: { logged: stretch.logged, fresh: [stretch.fresh] },
    firstStep: ws.runs.nextStep(meta.runId),
    holds: stretch.holds,
    history: stretch.history,
  })
}
