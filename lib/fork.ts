import { runLog } from './partialRun'
import { loadContinuation, startRun, type ContinuationVersions, type LiveWorkspace } from './runSession'
import type { AgentOutput, HoldRecord, Refusal, RunMeta } from './types'

export interface Fork {
  /** The nodes whose output changes; each one's descendants rerun. The first names the fork. */
  anchors: string[]
  /** The anchors' new outputs; an anchor without one reruns too. */
  outputs?: AgentOutput[]
  /** The re-answered hold, when an anchor is one. */
  hold?: HoldRecord
  versions?: ContinuationVersions
}

/** `POST /api/runs/:id/fork`'s body, read (capability `runFork`): rerun from `from`, and/or set `revisions` (node id → text). */
export interface ForkRequest {
  from?: string
  revisions?: Record<string, string>
  versions?: ContinuationVersions
}

/** A fork body's shape, before it meets a run. */
export function readForkRequest({ from, revisions, versions }: Record<string, unknown>): ForkRequest | { error: string } {
  if (from !== undefined && typeof from !== 'string') return { error: 'from must be a node id' }
  if (revisions !== undefined && !isTextMap(revisions)) return { error: 'revisions must map node ids to text' }
  if (versions !== undefined && versions !== 'current' && versions !== 'pinned') {
    return { error: "versions must be 'current' or 'pinned'" }
  }
  if (from === undefined && !Object.keys(revisions ?? {}).length) return { error: 'from or revisions is required' }
  if (from !== undefined && revisions && from in revisions) return { error: `Node ${from} cannot both rerun and be revised` }
  return { from, revisions, versions }
}

/**
 * A fork request read against its source. Every anchor's descendants rerun,
 * bar a revised one: the human's text stands even below another anchor.
 */
export function planFork(source: RunMeta, { from, revisions, versions }: ForkRequest): Fork | Refusal {
  const graph = source.graph
  if (!graph) return { error: 'Run has no recorded graph', status: 422 }
  const revised = Object.entries(revisions ?? {})
  const anchors = [...(from === undefined ? [] : [from]), ...revised.map(([nodeId]) => nodeId)]
  for (const nodeId of anchors) {
    if (!graph.nodes.some(n => n.id === nodeId)) return { error: `Node ${nodeId} is not in this run`, status: 404 }
  }

  const outputs: AgentOutput[] = []
  for (const [nodeId, text] of revised) {
    const node = graph.nodes.find(n => n.id === nodeId)!
    if (node.kind === 'hold') return { error: `Node ${nodeId} is a hold; answer it through resume`, status: 400 }
    if (node.zone) return { error: `Node ${nodeId} is inside a loop; its rounds cannot be revised`, status: 400 }
    const record = source.agentOutputs.findLast(o => o.nodeId === nodeId)
    if (!record) return { error: `Node ${nodeId} has no output in this run`, status: 400 }
    outputs.push(revisedOutput(record, text))
  }
  return { anchors, outputs, versions }
}

/** A new run of the source's graph, replaying what the anchors leave standing (#99, #103). */
export function forkRun(
  workspace: LiveWorkspace, source: RunMeta, fork: Fork, context: Record<string, string>,
): Response | Refusal {
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
