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
  lineage?: 'available' | 'unavailable'
  warning?: string
  nodes: ForkComparisonNode[]
}

/**
 * Builds a node-by-node comparison projection between a forked run and its source baseline (#130).
 * Replaced records collapse via runLog(...).current(), provenance distinguishes reuse from
 * unchanged regenerated text at the slot level (nodeId|round), and missing/error/skipped states are preserved.
 */
export function buildForkComparison(
  forkMeta: RunMeta,
  sourceMeta?: RunMeta | null,
): ForkComparison {
  const sourceBaseline = forkMeta.sourceOutputs ?? sourceMeta?.agentOutputs
  if (!sourceBaseline && !sourceMeta) {
    return {
      sourceRunId: forkMeta.branchedFromRunId ?? '',
      forkRunId: forkMeta.runId,
      ...(forkMeta.forkAnchors ? { forkAnchors: forkMeta.forkAnchors } : {}),
      lineage: 'unavailable',
      warning: 'Source run baseline is unavailable',
      nodes: [],
    }
  }

  const graph = forkMeta.graph ?? sourceMeta?.graph
  const currentSource = runLog({
    agentOutputs: sourceBaseline ?? [],
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

  // #130: Provenance records what was replayed at slot level (nodeId|round).
  const hasLegacyAnchors = Boolean(forkMeta.forkAnchors?.length || forkMeta.branchedFromNode)
  const hasProvenance = Boolean(forkMeta.replayedSlots || forkMeta.replayedNodeIds || hasLegacyAnchors)

  let isReplayed: (slotKey: string, nodeId: string) => boolean
  if (forkMeta.replayedSlots) {
    const slotSet = new Set(forkMeta.replayedSlots)
    isReplayed = slotKey => slotSet.has(slotKey)
  } else if (forkMeta.replayedNodeIds) {
    const nodeSet = new Set(forkMeta.replayedNodeIds)
    isReplayed = (_slotKey, nodeId) => nodeSet.has(nodeId)
  } else if (sourceMeta && hasLegacyAnchors) {
    const anchors = forkMeta.forkAnchors ?? (forkMeta.branchedFromNode ? [forkMeta.branchedFromNode] : [])
    const kept = runLog(sourceMeta).replayFor(anchors)
    const slotSet = new Set(kept.replay.map(o => recordKey(o)).filter(Boolean))
    isReplayed = slotKey => slotSet.has(slotKey)
  } else {
    isReplayed = () => false
  }

  // Preserve graph topological / declared order where available (#130).
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
      status = isReplayed(key, nodeId) ? 'reused' : 'regenerated'
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
    lineage: hasProvenance ? 'available' : 'unavailable',
    ...(hasProvenance ? {} : { warning: 'Lineage provenance unavailable for legacy fork' }),
    nodes,
  }
}
