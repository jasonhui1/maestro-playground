import { runLog, recordKey } from './partialRun'
import type { AgentOutput, RunMeta } from './types'

export type ForkNodeStatus = 'reused' | 'regenerated' | 'added' | 'removed'

export interface ForkComparisonNode {
  nodeId: string
  nodeName: string
  round?: number
  status: ForkNodeStatus
  sourceOutput?: string
  forkOutput?: string
  sourceStatus?: string
  forkStatus?: string
  sourceError?: string
  forkError?: string
}

export interface ForkComparison {
  sourceRunId: string
  forkRunId: string
  forkAnchors?: string[]
  nodes: ForkComparisonNode[]
}

/**
 * Builds a node-by-node comparison projection between a forked run and its source baseline (#130).
 * Replaced records collapse via runLog(...).current(), provenance distinguishes reuse from
 * unchanged regenerated text, and missing/error/skipped states are preserved.
 */
export function buildForkComparison(
  forkMeta: RunMeta,
  sourceMeta?: RunMeta | null,
): ForkComparison {
  const sourceBaseline = forkMeta.sourceOutputs ?? sourceMeta?.agentOutputs ?? []
  const graph = forkMeta.graph ?? sourceMeta?.graph

  const currentSource = runLog({
    agentOutputs: sourceBaseline,
    graph,
    holds: sourceMeta?.holds ?? [],
  }).current()

  const currentFork = runLog(forkMeta).current()

  const sourceMap = new Map<string, AgentOutput>()
  for (const o of currentSource) {
    if (o.nodeId) sourceMap.set(recordKey(o), o)
  }

  const forkMap = new Map<string, AgentOutput>()
  for (const o of currentFork) {
    if (o.nodeId) forkMap.set(recordKey(o), o)
  }

  // #130: Provenance records what was replayed; fallback to replay calculation for legacy runs.
  let replayedSet: Set<string>
  if (forkMeta.replayedNodeIds) {
    replayedSet = new Set(forkMeta.replayedNodeIds)
  } else if (sourceMeta) {
    const anchors = forkMeta.forkAnchors ?? (forkMeta.branchedFromNode ? [forkMeta.branchedFromNode] : [])
    const kept = runLog(sourceMeta).replayFor(anchors)
    replayedSet = new Set(kept.replay.map(o => o.nodeId).filter((id): id is string => Boolean(id)))
  } else {
    replayedSet = new Set()
  }

  // Preserve graph topological / declared order where available.
  const graphIndex = new Map<string, number>()
  if (graph?.nodes) {
    graph.nodes.forEach((n, i) => graphIndex.set(n.id, i))
  }

  const allKeys = new Set<string>()
  for (const k of forkMap.keys()) allKeys.add(k)
  for (const k of sourceMap.keys()) allKeys.add(k)

  const sortedKeys = [...allKeys].sort((a, b) => {
    const [nodeA, roundA] = a.split('|')
    const [nodeB, roundB] = b.split('|')
    const idxA = graphIndex.get(nodeA) ?? 9999
    const idxB = graphIndex.get(nodeB) ?? 9999
    if (idxA !== idxB) return idxA - idxB
    if (nodeA !== nodeB) return nodeA.localeCompare(nodeB)
    const rA = roundA !== '' ? Number(roundA) : -1
    const rB = roundB !== '' ? Number(roundB) : -1
    return rA - rB
  })

  const nodes: ForkComparisonNode[] = sortedKeys.map(key => {
    const sourceRec = sourceMap.get(key)
    const forkRec = forkMap.get(key)
    const [nodeId] = key.split('|')
    const round = forkRec?.round ?? sourceRec?.round

    const graphNode = graph?.nodes.find(n => n.id === nodeId)
    const nodeName = forkRec?.agentName
      ?? sourceRec?.agentName
      ?? (graphNode && 'agent' in graphNode && typeof graphNode.agent === 'string' ? graphNode.agent : undefined)
      ?? nodeId

    let status: ForkNodeStatus
    if (sourceRec && forkRec) {
      status = replayedSet.has(nodeId) ? 'reused' : 'regenerated'
    } else if (sourceRec && !forkRec) {
      status = 'removed'
    } else {
      status = 'added'
    }

    const sourceStatus = sourceRec ? sourceRec.status : 'missing'
    const forkStatus = forkRec
      ? forkRec.status
      : (forkMeta.status === 'running' ? 'pending' : 'missing')

    return {
      nodeId,
      nodeName,
      ...(round !== undefined ? { round } : {}),
      status,
      ...(sourceRec?.output !== undefined ? { sourceOutput: sourceRec.output } : {}),
      ...(forkRec?.output !== undefined ? { forkOutput: forkRec.output } : {}),
      sourceStatus,
      forkStatus,
      ...(sourceRec?.error ? { sourceError: sourceRec.error } : {}),
      ...(forkRec?.error ? { forkError: forkRec.error } : {}),
    }
  })

  return {
    sourceRunId: forkMeta.branchedFromRunId ?? sourceMeta?.runId ?? '',
    forkRunId: forkMeta.runId,
    ...(forkMeta.forkAnchors ? { forkAnchors: forkMeta.forkAnchors } : {}),
    nodes,
  }
}
