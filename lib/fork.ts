import { initRunDir } from './logger'
import { runLog } from './partialRun'
import {
  contextOverrides, loadContinuation, newRunId, streamChainRun, type ContinuationVersions, type Refusal,
} from './runSession'
import type { AgentOutput, HoldRecord, RunMeta } from './types'

export interface Fork {
  /** The nodes whose output changes; each one's descendants rerun. The first names the fork. */
  anchors: string[]
  /** The anchors' new outputs; an anchor without one reruns too. */
  outputs?: AgentOutput[]
  /** The re-answered hold, when an anchor is one. */
  hold?: HoldRecord
  versions?: ContinuationVersions
  context?: unknown
}

/** A new run of the source's graph, replaying what the anchors leave standing (#99, #103). */
export function forkRun(source: RunMeta, fork: Fork): Response | Refusal {
  const continuation = loadContinuation(source, fork.versions)
  if ('error' in continuation) return continuation
  const graph = source.graph!
  const kept = runLog(source).replayFor(fork.anchors)
  const replay = [...kept.replay, ...(fork.outputs ?? [])]
  const holds = [...kept.holds, ...(fork.hold ? [fork.hold] : [])]

  const { chain, workspace, versionNumber, versions, pinnedContext } = continuation
  const runId = newRunId()
  initRunDir({
    runId,
    chainName: source.chainName,
    seedPrompt: source.seedPrompt,
    parameter: source.parameter,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    holds,
    graph,
    branchedFromRunId: source.runId,
    branchedFromNode: fork.anchors[0],
    versionNumber: versionNumber > 0 ? versionNumber : undefined,
    versions,
  })

  return streamChainRun({
    chain,
    workspace,
    runId,
    seedPrompt: source.seedPrompt,
    paramValue: source.parameter?.value ?? '',
    context: { ...pinnedContext, ...contextOverrides(fork.context) },
    replay,
    versionNumber,
    holds,
  })
}

/** `POST /api/runs/:id/fork`'s body, as sent; `planFork` reads it (capability `runFork`). */
export interface ForkRequest {
  from?: unknown
  revisions?: unknown
  versions?: unknown
  context?: unknown
}

/**
 * A fork request read against its source: rerun from `from`, and/or set `revisions`
 * (node id → text) as those nodes' outputs. Either way their descendants rerun,
 * bar a revised one: the human's text stands even below another anchor.
 */
export function planFork(
  source: RunMeta,
  { from, revisions, versions, context }: ForkRequest,
): Fork | Refusal {
  const graph = source.graph
  if (!graph) return { error: 'Run has no recorded graph', status: 422 }
  if (from !== undefined && typeof from !== 'string') return { error: 'from must be a node id', status: 400 }
  if (revisions !== undefined && !isTextMap(revisions)) {
    return { error: 'revisions must map node ids to text', status: 400 }
  }
  if (versions !== undefined && versions !== 'current' && versions !== 'pinned') {
    return { error: "versions must be 'current' or 'pinned'", status: 400 }
  }
  const revised = Object.entries(revisions ?? {})
  if (from === undefined && !revised.length) return { error: 'from or revisions is required', status: 400 }
  if (from !== undefined && revisions && from in revisions) {
    return { error: `Node ${from} cannot both rerun and be revised`, status: 400 }
  }

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
  return { anchors, outputs, versions, context }
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
