import { AgentOutput, ChainDef, ChainNode, ChainEdge } from './types'

// All ancestors of targetId (incl. itself), with any touched loop zone fully included.
export function upstreamSubgraph(chain: ChainDef, targetId: string): { nodes: ChainNode[]; edges: ChainEdge[] } {
  const incoming = new Map<string, string[]>()
  for (const e of chain.edges) {
    const arr = incoming.get(e.toNode) ?? []
    arr.push(e.fromNode)
    incoming.set(e.toNode, arr)
  }
  const zoneOf = new Map(chain.nodes.map(n => [n.id, n.zone]))
  const keep = new Set<string>([targetId])

  let changed = true
  while (changed) {
    changed = false
    // pull in ancestors of everything currently kept
    for (const id of [...keep]) {
      for (const src of incoming.get(id) ?? []) {
        if (!keep.has(src)) { keep.add(src); changed = true }
      }
    }
    // pull in every member of any zone we've touched
    const zones = new Set<string>()
    for (const id of keep) { const z = zoneOf.get(id); if (z) zones.add(z) }
    for (const n of chain.nodes) {
      if (n.zone && zones.has(n.zone) && !keep.has(n.id)) { keep.add(n.id); changed = true }
    }
  }

  return {
    nodes: chain.nodes.filter(n => keep.has(n.id)),
    edges: chain.edges.filter(e => keep.has(e.fromNode) && keep.has(e.toNode)),
  }
}

// Every node downstream of sourceId (not itself), with any touched loop zone fully included.
export function downstreamIds(graph: { nodes: ChainNode[]; edges: ChainEdge[] }, sourceId: string): Set<string> {
  const zoneOf = new Map(graph.nodes.map(n => [n.id, n.zone]))
  const found = new Set<string>()
  const queue = [sourceId]
  const reach = (id: string) => {
    if (id === sourceId || found.has(id)) return
    found.add(id)
    queue.push(id)
  }
  while (queue.length) {
    const id = queue.shift()!
    for (const e of graph.edges) if (e.fromNode === id) reach(e.toNode)
    const zone = id === sourceId ? undefined : zoneOf.get(id)
    if (zone) for (const n of graph.nodes) if (n.zone === zone) reach(n.id)
  }
  return found
}

// Every record not written by one of `nodeIds`; records with no node stay.
export function withoutNodes(outputs: AgentOutput[], nodeIds: Set<string>): AgentOutput[] {
  return outputs.filter(o => !o.nodeId || !nodeIds.has(o.nodeId))
}
