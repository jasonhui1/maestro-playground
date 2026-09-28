import { runLog, recordKey } from './partialRun'
import { badRequest, notFound, unprocessable } from './refusal'
import { loadContinuation, startRun, type ContinuationVersions, type LiveWorkspace, type StartRunInput } from './runSession'
import type { Workspace } from './runFolders'
import type { AgentOutput, HoldRecord, Refusal, RunMeta } from './types'

import { resolveContinuationModelOverride, parseModelOverride } from './pricing'

export interface Fork {
  /** The nodes whose output changes; each one's descendants rerun. The first names the fork. */
  anchors: string[]
  /** The anchors' new outputs; an anchor without one reruns too. */
  outputs?: AgentOutput[]
  /** The re-answered hold, when an anchor is one. */
  hold?: HoldRecord
  versions?: ContinuationVersions
  modelOverride?: string
}

/** `POST /api/runs/:id/fork`'s body, read (capability `runFork`): rerun from `from`, and/or set `revisions` (node id → text). */
export interface ForkRequest {
  from?: string
  revisions?: Record<string, string>
  versions?: ContinuationVersions
  modelOverride?: string | null
}

/** A fork body's shape, before it meets a run. */
export function readForkRequest({ from, revisions, versions, modelOverride }: Record<string, unknown>): ForkRequest | Refusal {
  if (from !== undefined && typeof from !== 'string') return badRequest('from must be a node id')
  if (revisions !== undefined && !isTextMap(revisions)) return badRequest('revisions must map node ids to text')
  if (versions !== undefined && versions !== 'current' && versions !== 'pinned') {
    return badRequest("versions must be 'current' or 'pinned'")
  }
  const parsedOverride = parseModelOverride(modelOverride)
  if (!parsedOverride.valid) return badRequest(parsedOverride.error)
  if (from === undefined && !Object.keys(revisions ?? {}).length) return badRequest('from or revisions is required')
  if (from !== undefined && revisions && from in revisions) return badRequest(`Node ${from} cannot both rerun and be revised`)
  return {
    from,
    revisions,
    versions,
    ...(parsedOverride.value !== undefined ? { modelOverride: parsedOverride.value } : {}),
  }
}

/**
 * A fork request read against its source. Every anchor's descendants rerun,
 * bar a revised one: the human's text stands even below another anchor.
 */
export function planFork(source: RunMeta, { from, revisions, versions, modelOverride }: ForkRequest): Fork | Refusal {
  const graph = source.graph
  if (!graph) return unprocessable('Run has no recorded graph')
  const revised = Object.entries(revisions ?? {})
  const anchors = [...(from === undefined ? [] : [from]), ...revised.map(([nodeId]) => nodeId)]
  for (const nodeId of anchors) {
    if (!graph.nodes.some(n => n.id === nodeId)) return notFound(`Node ${nodeId} is not in this run`)
  }

  const outputs: AgentOutput[] = []
  for (const [nodeId, text] of revised) {
    const node = graph.nodes.find(n => n.id === nodeId)!
    if (node.kind === 'hold') return badRequest(`Node ${nodeId} is a hold; answer it through resume`)
    if (node.zone) return badRequest(`Node ${nodeId} is inside a loop; its rounds cannot be revised`)
    const record = source.agentOutputs.findLast(o => o.nodeId === nodeId)
    if (!record) return badRequest(`Node ${nodeId} has no output in this run`)
    outputs.push(revisedOutput(record, text))
  }
  // #128: Omission inherits source override; null clears; nonempty string replaces.
  const effectiveOverride = resolveContinuationModelOverride(source.modelOverride, modelOverride)
  return { anchors, outputs, versions, modelOverride: effectiveOverride }
}

/** A new run of the source's graph, replaying what the anchors leave standing (#99, #103). */
export function forkRun(
  ws: Workspace, workspace: LiveWorkspace, source: RunMeta, fork: Fork, context: Record<string, string>,
): Response | Refusal {
  const start = forkStart(ws, workspace, source, fork, context)
  return 'error' in start ? start : startRun(ws, start)
}

/** What a fork's new run starts from, before anything in it runs. */
export function forkStart(
  ws: Workspace, workspace: LiveWorkspace, source: RunMeta, fork: Fork, context: Record<string, string>,
): StartRunInput | Refusal {
  const continuation = loadContinuation(ws.root, workspace, source, fork.versions)
  if ('error' in continuation) return continuation
  const kept = runLog(source).replayFor(fork.anchors)
  const { chain, workspace: defs, versionNumber, versions, pinnedContext } = continuation
  // #130: Record complete anchors, replayed node IDs & slots, and snapshot baseline source outputs.
  const replayedNodeIds = [...new Set(kept.replay.map(o => o.nodeId).filter((id): id is string => Boolean(id)))]
  const replayedSlots = kept.replay.map(o => recordKey(o)).filter(Boolean)
  const sourceOutputs = runLog(source).current()
  return {
    chain,
    workspace: defs,
    title: source.chainName,
    seedPrompt: source.seedPrompt,
    parameter: source.parameter,
    context,
    pinnedContext,
    versions,
    versionNumber,
    modelOverride: fork.modelOverride,
    replay: [...kept.replay, ...(fork.outputs ?? [])],
    holds: [...kept.holds, ...(fork.hold ? [fork.hold] : [])],
    forkedFrom: { runId: source.runId, nodeId: fork.anchors[0] },
    forkAnchors: fork.anchors,
    replayedNodeIds,
    replayedSlots,
    sourceOutputs,
    chainSlug: source.chainSlug,
    entrypoint: source.entrypoint,
  }
}

function isTextMap(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(v => typeof v === 'string')
}

// Nothing ran, so metrics are zero; the thought and chat argued for the old text.
function revisedOutput(record: AgentOutput, output: string): AgentOutput {
  const revised: AgentOutput = {
    ...record, output, status: 'success',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, timestamp: new Date().toISOString(),
  }
  delete revised.thought
  delete revised.error
  delete revised.conversation
  return revised
}
