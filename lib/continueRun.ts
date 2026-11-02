import {
  answerHold, checkRevision, hasAnsweredHold, readPick, reopenHold, revisionOf, selectHold, withFeedback,
  type AnswerRequest, type HoldUpdate,
} from './hold'
import { readyReroll, streamReroll, type ReadyReroll, type RerollRequest } from './reroll'
import { planPromotion, type PromoteRequest } from './promote'
import { planFork, type ForkRequest } from './fork'
import { recordKey, runLog } from './partialRun'
import { loggedStep } from './nodeChat'
import { loadRunFor } from './loadRun'
import { newRunId } from './logger'
import { conflict, toResponse } from './refusal'
import { resolveContinuationModelOverride, withModelOverride } from './modelOverride'
import { diceField, rollRunDice } from './dice'
import type { LiveWorkspace, Workspace } from './runFolders'
import { stretchLog, type RunEdit } from './stretchLog'
import { contextOverrides, startRun, streamChainRun, type StartRunInput } from './runSession'
import { runFiles, type ContinuationVersions } from './runFiles'
import type { AgentOutput, HoldRecord, Refusal, RunMeta } from './types'

/** What a continuation does to a run: answer a hold (resume), reroll its candidates, promote a reply, or fork. */
export type ContinuePlan =
  | { answer: AnswerRequest }
  | { reroll: RerollRequest }
  | { promote: PromoteRequest }
  | { fork: ForkRequest }

/**
 * Continues run `runId` by `plan`, in place or as a fork (#99, #107); refusals come back as JSON.
 * A running run is refused (#104), bar a reroll fork (#147). In place, earlier records replay as
 * the objects in `meta.agentOutputs` and keep their logs (ADR-0011).
 */
export function continueRun(
  ws: Workspace,
  runId: string,
  plan: ContinuePlan,
  requestContext?: unknown,
): Response {
  // A reroll decides whether it forks from the hold; in place, it claims the run itself.
  const meta = loadRunFor(ws.runs, runId, { mustNotBeRunning: !('reroll' in plan) })
  if ('error' in meta) return toResponse(meta)
  const workspace = ws.definitions()
  const stretch = 'answer' in plan ? answer(meta, plan.answer)
    : 'reroll' in plan ? reroll(workspace, meta, plan.reroll)
    : 'promote' in plan ? promote(ws, meta, plan.promote)
    : fork(meta, plan.fork)
  const res = 'error' in stretch ? stretch : streamStretch(ws, workspace, meta, stretch, contextOverrides(requestContext))
  return 'error' in res ? toResponse(res) : res
}

type Place = 'in-place' | 'fork'

interface Change {
  place: Place
  /** The nodes whose output changes; each one's descendants rerun. The first names a fork. */
  anchors: string[]
  /** The run's records as this stretch reads them, when the plan amends some. */
  history?: AgentOutput[]
  /** As requested: omitted inherits the source's, null clears it (#128). */
  modelOverride?: string | null
  versions?: ContinuationVersions
}

/** A stretch the executor runs from the anchors' new records. */
interface GraphStretch extends Change {
  outputs: AgentOutput[]
  /** The anchor hold's new record; in place, the run's holds with it. */
  hold?: HoldUpdate
  /** A promote's flag on its source record, whose log is rewritten (#98). */
  flag?: { step: number; record: AgentOutput }
}

/** A stretch that reruns the hold's one producer, then stops (#134). */
interface RerollStretch extends Change {
  reroll: ReadyReroll
  hold: HoldUpdate
}

type Stretch = GraphStretch | RerollStretch

/**
 * In place or fork, for every continuation (#99, #76, #147): a fork when asked, or when in place
 * would ask an answered hold again; rerunning from a node also forks a run that is not waiting.
 */
function placeOf(meta: RunMeta, at: { hold: HoldRecord } | { node: string }, asked = false): Place | Refusal {
  const forks = asked || ('hold' in at
    ? at.hold.resolvedAt !== undefined
    : meta.status !== 'waiting' || hasAnsweredHold(meta.holds, runLog(meta).below(at.node)))
  if (forks) return 'fork'
  return meta.status === 'waiting' ? 'in-place' : conflict(`Run is ${meta.status}, not waiting`)
}

function answer(meta: RunMeta, request: AnswerRequest): GraphStretch | Refusal {
  const { holdId, direction, chosen, custom, modelOverride, revision } = request
  const hold = selectHold(meta, holdId)
  if ('error' in hold) return hold
  const pick = readPick(hold, chosen, custom)
  if (pick && 'error' in pick) return pick
  const stale = checkRevision(hold, revision, pick)
  if (stale) return stale
  const place = placeOf(meta, { hold }, request.fork === true)
  if (typeof place !== 'string') return place

  // The answer is recorded up front, so a run that fails after it still shows what was said.
  const answered = answerHold(meta.holds ?? [], hold, direction, pick)
  return { place, anchors: [hold.nodeId], outputs: [answered.output], hold: answered, modelOverride }
}

function promote(ws: Workspace, meta: RunMeta, { nodeId, turn }: PromoteRequest): GraphStretch | Refusal {
  const plan = planPromotion(meta, nodeId, turn)
  if ('error' in plan) return plan
  const step = loggedStep(ws.runs, meta.runId, nodeId)
  if (typeof step !== 'number') return step
  const place = placeOf(meta, { node: nodeId })
  if (typeof place !== 'string') return place
  return {
    place, anchors: [nodeId], outputs: [plan.revision],
    history: plan.flaggedOutputs, flag: { step, record: plan.source },
  }
}

function fork(meta: RunMeta, request: ForkRequest): GraphStretch | Refusal {
  const plan = planFork(meta, request)
  if ('error' in plan) return plan
  const place = placeOf(meta, { node: plan.anchors[0] }, true)
  return typeof place === 'string' ? { ...plan, place } : place
}

function reroll(workspace: LiveWorkspace, meta: RunMeta, request: RerollRequest): RerollStretch | Refusal {
  const source = selectHold(meta, request.holdId)
  if ('error' in source) return source
  const place = placeOf(meta, { hold: source }, request.fork === true || request.like !== undefined)
  if (typeof place !== 'string') return place
  const ready = readyReroll(workspace, meta, source, request)
  if ('error' in ready) return ready

  if (place === 'in-place') {
    // Request feedback is saved before generating; a failed attempt keeps it (#134).
    const hold = request.feedback === undefined
      ? { record: source, holds: meta.holds ?? [] }
      : withFeedback(meta.holds ?? [], source, request.feedback)
    return { place, anchors: [source.nodeId], hold, reroll: ready }
  }
  // #147: feedback and `like` belong to one hold, so the fork's come from the request alone.
  const record = reopenHold(source)
  delete record.feedback
  delete record.like
  if (request.feedback) record.feedback = request.feedback
  if (ready.like) record.like = { candidate: ready.like, revision: revisionOf(source) }
  return {
    place, anchors: [source.nodeId], hold: { record, holds: [] }, reroll: ready,
    // #147: the source's own rerolls answered its hold; this one starts again from the original record.
    history: meta.agentOutputs.filter(o => o.nodeId !== ready.producer.id || !o.reroll),
  }
}

function streamStretch(
  ws: Workspace, workspace: LiveWorkspace, meta: RunMeta, stretch: Stretch, context: Record<string, string>,
): Response | Refusal {
  const loaded = runFiles(ws, workspace, stretch.place === 'fork'
    ? { kind: 'fork', run: meta, files: stretch.versions ?? 'current' }
    : { kind: 'inPlace', run: meta })
  if ('error' in loaded) return loaded
  const modelOverride = resolveContinuationModelOverride(meta.modelOverride, stretch.modelOverride)
  const history = stretch.history ?? meta.agentOutputs
  const kept = runLog({ agentOutputs: history, graph: meta.graph, holds: meta.holds }).replayFor(stretch.anchors)
  const outputs = 'outputs' in stretch ? stretch.outputs : []
  const flag = 'flag' in stretch ? stretch.flag : undefined
  const { chain, definitions: defs, versionNumber } = loaded

  const forkStart = (): StartRunInput & { replay: AgentOutput[]; holds: HoldRecord[] } => ({
    chain, workspace: defs, title: meta.chainName, seedPrompt: meta.seedPrompt, parameter: meta.parameter,
    inputs: meta.inputs, dice: meta.dice,
    context, pinnedContext: loaded.pinnedContext, versions: loaded.versions, versionNumber,
    modelOverride, imageOverride: meta.imageOverride,
    replay: [...kept.replay, ...outputs],
    holds: [...kept.holds, ...(stretch.hold ? [stretch.hold.record] : [])],
    forkedFrom: { runId: meta.runId, nodeId: stretch.anchors[0] },
    forkAnchors: stretch.anchors,
    // #130: what the fork replayed, and the source's outputs as a baseline to compare against.
    replayedNodeIds: [...new Set(kept.replay.flatMap(o => (o.nodeId ? [o.nodeId] : [])))],
    replayedSlots: kept.replay.map(recordKey),
    sourceOutputs: runLog(meta).current(),
    chainSlug: meta.chainSlug,
    entrypoint: meta.entrypoint,
    // The source keeps its history; only the flag on the promoted reply is new.
    ...(flag ? { source: { runId: meta.runId, patch: { agentOutputs: history }, rewrite: { step: flag.step, output: flag.record } } } : {}),
  })
  const inPlace: RunEdit = {
    runId: meta.runId,
    patch: {
      ...(stretch.hold ? { holds: stretch.hold.holds } : {}),
      ...(outputs.length ? { agentOutputs: [...history, ...outputs] } : {}),
      ...(stretch.modelOverride === null ? { modelOverride: undefined } : modelOverride ? { modelOverride } : {}),
    },
    ...(flag ? { rewrite: { step: flag.step, output: flag.record } } : {}),
  }

  if ('reroll' in stretch) {
    const common = {
      ws, workspace, source: meta, chain, versionNumber, hold: stretch.hold.record,
      ready: { ...stretch.reroll, agent: withModelOverride(stretch.reroll.agent, modelOverride) },
    }
    if (stretch.place === 'fork') {
      const start = forkStart()
      const log = stretchLog(ws.runs, { create: { runId: newRunId(), run: start } }, versionNumber)
      return streamReroll({ ...common, log, holds: start.holds, fork: { replay: start.replay } })
    }
    const log = stretchLog(ws.runs, { claim: inPlace }, versionNumber)
    if (!log.open()) return conflict('Run is running')
    return streamReroll({ ...common, log, holds: stretch.hold.holds })
  }

  if (stretch.place === 'fork') return startRun(ws, forkStart())
  const dice = rollRunDice(chain, defs, meta.dice)
  const log = stretchLog(ws.runs, { claim: { ...inPlace, patch: { ...inPlace.patch, ...diceField(dice) } } }, versionNumber)
  if (!log.open()) return conflict('Run is running')
  return streamChainRun({
    ws, log, chain, workspace: defs, context, modelOverride, dice,
    seedPrompt: meta.seedPrompt,
    inputs: meta.inputs,
    paramValue: meta.parameter?.value ?? '',
    replay: { logged: kept.replay, fresh: outputs },
    holds: stretch.hold?.holds ?? meta.holds,
    history,
  })
}
