/** Kahn's sort. Edges with an endpoint outside `ids` are ignored; nodes on a cycle are left out. */
export function topoSort(ids: string[], edges: { fromNode: string; toNode: string }[]): string[] {
  const indeg = new Map<string, number>(ids.map(id => [id, 0]))
  const adj = new Map<string, string[]>(ids.map(id => [id, []]))
  for (const e of edges) {
    if (!indeg.has(e.toNode) || !adj.has(e.fromNode)) continue
    adj.get(e.fromNode)!.push(e.toNode)
    indeg.set(e.toNode, (indeg.get(e.toNode) || 0) + 1)
  }
  const queue = ids.filter(id => (indeg.get(id) || 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const t of adj.get(id) || []) {
      indeg.set(t, (indeg.get(t) || 0) - 1)
      if ((indeg.get(t) || 0) === 0) queue.push(t)
    }
  }
  return order
}
