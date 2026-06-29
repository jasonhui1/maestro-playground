import { ChainNode, ChainEdge } from './types'

export function uniqueNodeId(kind: string, existing: string[]): string {
  const set = new Set(existing)
  let i = 1
  while (set.has(`${kind}-${i}`)) i++
  return `${kind}-${i}`
}

// The full id space a node list occupies: node ids PLUS the distinct zone ids they
// reference. Mint fresh node *or* zone ids against this. Zone ids live in `node.zone`,
// never in the node-id list, so checking node ids alone hands back an already-used zone
// id — two loops collapsing into one zone. Callers that add/paste zones must pass this.
export function reservedIds(nodes: ChainNode[]): string[] {
  const zones = new Set<string>()
  for (const n of nodes) if (n.zone) zones.add(n.zone)
  return [...nodes.map(n => n.id), ...zones]
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

export interface Subgraph {
  nodes: ChainNode[]
  edges: ChainEdge[]
}

// Selected nodes plus only the edges whose BOTH endpoints are in the selection.
export function copySubgraph(nodes: ChainNode[], edges: ChainEdge[], ids: string[]): Subgraph {
  const set = new Set(ids)
  return {
    nodes: nodes.filter(n => set.has(n.id)).map(n => structuredClone(n)),
    edges: edges.filter(e => set.has(e.fromNode) && set.has(e.toNode)).map(e => ({ ...e })),
  }
}

// Clone a subgraph with fresh node ids, fresh zone ids, remapped edges and offset positions.
export function pasteSubgraph(
  clip: Subgraph,
  existingIds: string[],
  offset: [number, number],
): { nodes: ChainNode[]; edges: ChainEdge[]; newIds: string[] } {
  const taken = [...existingIds]
  const idMap = new Map<string, string>()
  for (const n of clip.nodes) {
    const fresh = uniqueNodeId(n.kind, taken)
    idMap.set(n.id, fresh)
    taken.push(fresh)
  }
  const zoneMap = new Map<string, string>()
  for (const n of clip.nodes) {
    if (n.zone && !zoneMap.has(n.zone)) {
      const freshZone = uniqueNodeId('zone', taken)
      zoneMap.set(n.zone, freshZone)
      taken.push(freshZone)
    }
  }
  const nodes: ChainNode[] = clip.nodes.map(n => {
    const copy = structuredClone(n)
    copy.id = idMap.get(n.id)!
    if (n.zone) copy.zone = zoneMap.get(n.zone)!
    const [x, y] = n.pos ?? [0, 0]
    copy.pos = [x + offset[0], y + offset[1]]
    return copy
  })
  const edges: ChainEdge[] = clip.edges.map(e => ({
    fromNode: idMap.get(e.fromNode)!,
    fromSocket: e.fromSocket,
    toNode: idMap.get(e.toNode)!,
    toSocket: e.toSocket,
  }))
  return { nodes, edges, newIds: [...idMap.values()] }
}
