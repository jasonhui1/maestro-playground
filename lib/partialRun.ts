import { ChainDef, ChainNode, ChainEdge } from './types'

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
