import { answerHold, readPick, selectHold } from './hold'
import { CHAT_REFUSAL_STATUS } from './nodeChat'
import { planPromotion, type PromoteRefusal } from './promote'
import { planFork, type Fork, type ForkRequest } from './fork'
import { runLog } from './partialRun'
import { latestStepOf, nextStep, updateRunMeta, writeAgentLog } from './logger'
import { contextOverrides, loadContinuation, startRun, streamChainRun, type LiveWorkspace } from './runSession'
import type { AgentOutput, HoldRecord, Refusal, RunMeta } from './types'

/** What a continuation does to a run: answer a hold (resume), promote a reply, or fork. */
export type ContinuePlan =
  /** Resume: answer the named hold, else the open one; `chosen` names a candidate, `custom` is the human's own. */
  | { answer: { holdId?: unknown; direction: string; chosen?: unknown; custom?: unknown } }
  /** Use this: a proposer's reply, by `### Turn N` (the last by default), becomes its output. */
  | { promote: { nodeId: string; turn?: number } }
  | { fork: ForkRequest }

const PROMOTE_REFUSAL_STATUS: Record<PromoteRefusal, number> = {
  ...CHAT_REFUSAL_STATUS, 'bad-turn': 400, 'in-loop': 400,
}

/**
 * Continues `meta`'s run by `plan`, in place or as a fork (#99, #107); refusals come back as JSON.
 * In place, earlier records replay as the objects in `meta.agentOutputs` and keep their logs (ADR-0011).
 */
export function continueRun(
  workspace: LiveWorkspace,
  meta: RunMeta,
  plan: ContinuePlan,
  context?: unknown,
): Response {
  const res = meta.status === 'running' ? { error: 'Run is running', status: 409 }
    : 'answer' in plan ? answer(workspace, meta, plan.answer, context)
    : 'promote' in plan ? promote(workspace, meta, plan.promote, context)
    : fork(workspace, meta, plan.fork, context)
  return 'error' in res ? Response.json({ error: res.error, errors: res.errors }, { status: res.status }) : res
}

function answer(
  workspace: LiveWorkspace, meta: RunMeta,
  { holdId, direction, chosen, custom }: Extract<ContinuePlan, { answer: unknown }>['answer'],
  context: unknown,
): Response | Refusal {
  const hold = selectHold(meta, holdId)
  if ('error' in hold) return hold
  const pick = readPick(hold, chosen, custom)
  if (pick && 'error' in pick) return pick

  const answered = answerHold(meta.holds ?? [], hold, direction, pick)
  if (answered.mode === 'fork') {
    return forkRun(workspace, meta, { anchors: [hold.nodeId], outputs: [answered.output], hold: answered.record }, context)
  }
  if (meta.status !== 'waiting') return { error: `Run is ${meta.status}, not waiting`, status: 409 }

  // The answer is recorded up front, so a run that fails after it still shows what was said.
  const { holds, output } = answered
  return inPlace(workspace, meta, {
    logged: meta.agentOutputs, fresh: output, holds,
    metaUpdate: { holds, agentOutputs: [...meta.agentOutputs, output] },
  }, context)
}

function promote(
  workspace: LiveWorkspace, meta: RunMeta,
  { nodeId, turn }: Extract<ContinuePlan, { promote: unknown }>['promote'],
  context: unknown,
): Response | Refusal {
  const plan = planPromotion(meta, nodeId, turn)
  if ('refused' in plan) return { error: plan.reason, status: PROMOTE_REFUSAL_STATUS[plan.refused] }
  const sourceStep = latestStepOf(meta.runId, nodeId)
  if (sourceStep === undefined) return { error: `Node ${nodeId} has no log in this run`, status: 400 }

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

function fork(workspace: LiveWorkspace, meta: RunMeta, request: ForkRequest, context: unknown): Response | Refusal {
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
  context: unknown,
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
    context: contextOverrides(context),
    replay: { logged: stretch.logged, fresh: [stretch.fresh] },
    firstStep: nextStep(meta.runId),
    holds: stretch.holds,
    history: stretch.history,
  })
}

/** A new run of the source's graph, replaying what the anchors leave standing (#99, #103). */
function forkRun(workspace: LiveWorkspace, source: RunMeta, fork: Fork, context: unknown): Response | Refusal {
  const continuation = loadContinuation(workspace, source, fork.versions)
  if ('error' in continuation) return continuation
  const kept = runLog(source).replayFor(fork.anchors)
  const { chain, workspace: defs, versionNumber, versions, pinnedContext } = continuation
  return startRun({
    chain,
    workspace: defs,
    title: source.chainName,
    seedPrompt: source.seedPrompt,
    parameter: source.parameter,
    context,
    pinnedContext,
    versions,
    versionNumber,
    replay: [...kept.replay, ...(fork.outputs ?? [])],
    holds: [...kept.holds, ...(fork.hold ? [fork.hold] : [])],
    forkedFrom: { runId: source.runId, nodeId: fork.anchors[0] },
  })
}
