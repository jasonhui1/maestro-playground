import { ChainNode, ChainEdge } from './types'

export function uniqueNodeId(kind: string, existing: string[]): string {
  const set = new Set(existing)
  let i = 1
  while (set.has(`${kind}-${i}`)) i++
  return `${kind}-${i}`
}

export function connectEdge(edges: ChainEdge[], edge: ChainEdge): ChainEdge[] {
  const kept = edges.filter(e => !(e.toNode === edge.toNode && e.toSocket === edge.toSocket))
  return [...kept, edge]
}

export function deleteNode(
  nodes: ChainNode[],
  edges: ChainEdge[],
  id: string,
): { nodes: ChainNode[]; edges: ChainEdge[] } {
  return {
    nodes: nodes.filter(n => n.id !== id),
    edges: edges.filter(e => e.fromNode !== id && e.toNode !== id),
  }
}

export function deleteEdge(edges: ChainEdge[], edge: ChainEdge): ChainEdge[] {
  return edges.filter(
    e => !(e.fromNode === edge.fromNode && e.fromSocket === edge.fromSocket &&
           e.toNode === edge.toNode && e.toSocket === edge.toSocket),
  )
}

export function makeLoopZone(existingIds: string[], pos: [number, number]): ChainNode[] {
  const zone = uniqueNodeId('zone', existingIds)
  const startId = uniqueNodeId('loop-start', existingIds)
  const endId = uniqueNodeId('loop-end', [...existingIds, startId])
  return [
    { id: startId, kind: 'loop-start', zone, state: [], pos },
    { id: endId, kind: 'loop-end', zone, until: '', maxIterations: 3, pos: [pos[0] + 360, pos[1]] },
  ]
}
