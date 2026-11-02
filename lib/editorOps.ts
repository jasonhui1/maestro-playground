import { ChainNode, ChainEdge, ChainNodeKind } from './types'
import { inputAcceptsMany, type WorkspaceLookup } from './nodeKinds'
import { edgeShapeError } from './chainGraph'
import { isBoundary, renameZone, zoneNames } from './zones'
import { adoptOnDrop } from './zoneLayout'

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
  return [...nodes.map(n => n.id), ...zoneNames(nodes)]
}

export function connectEdge(nodes: ChainNode[], edges: ChainEdge[], edge: ChainEdge, workspace: WorkspaceLookup): ChainEdge[] {
  const dst = nodes.find(n => n.id === edge.toNode)
  const isMulti = dst ? inputAcceptsMany(dst, edge.toSocket, { ...workspace, chain: { ...workspace.chain, nodes, edges } }) : false
  if (isMulti) {
    const dup = edges.some(e =>
      e.fromNode === edge.fromNode && e.fromSocket === edge.fromSocket &&
      e.toNode === edge.toNode && e.toSocket === edge.toSocket)
    return dup ? edges : [...edges, edge]
  }
  const kept = edges.filter(e => !(e.toNode === edge.toNode && e.toSocket === edge.toSocket))
  return [...kept, edge]
}

// A new node's id is minted against the full id space, so it can never take a zone's id.
export function addNodeOfKind(
  nodes: ChainNode[],
  kind: ChainNodeKind,
  pos: [number, number],
  extra?: Partial<ChainNode>,
): ChainNode[] {
  return [...nodes, { id: uniqueNodeId(kind, reservedIds(nodes)), kind, pos, ...extra } as ChainNode]
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

export function updateNode(
  nodes: ChainNode[],
  id: string,
  patch: Partial<ChainNode>,
): ChainNode[] {
  const target = nodes.find(n => n.id === id)
  if (
    target &&
    isBoundary(target) &&
    patch.zone !== undefined &&
    target.zone &&
    patch.zone !== target.zone
  ) {
    const renamed = renameZone(nodes, target.zone, patch.zone)
    return renamed.map(n => (n.id === id ? { ...n, ...patch } : n))
  }
  return nodes.map(n => (n.id === id ? { ...n, ...patch } : n))
}

export function moveMany(
  nodes: ChainNode[],
  updates: { id: string; pos: [number, number] }[],
): ChainNode[] {
  const m = new Map(updates.map(u => [u.id, u.pos]))
  return nodes.map(n => (m.has(n.id) ? { ...n, pos: m.get(n.id)! } : n))
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

export type QuickAddItem =
  | { type: 'agent'; slug: string }
  | { type: 'source-seed' }
  | { type: 'source-context'; file?: string }
  | { type: 'control-loop' }
  | { type: 'control-gate' }

function quickAddOp(item: QuickAddItem, pos: [number, number]): EditorOp {
  switch (item.type) {
    case 'agent': return editorOps.addNode('agent', pos, { agent: item.slug })
    case 'source-seed': return editorOps.addNode('seed', pos)
    case 'source-context': return editorOps.addNode('context', pos, item.file ? { file: item.file } : undefined)
    case 'control-loop': return editorOps.addLoopZone(pos)
    case 'control-gate': return editorOps.addNode('gate', pos)
  }
}

export interface EditorGraph {
  nodes: ChainNode[]
  edges: ChainEdge[]
  selectedIds: string[]
  clipboard: Subgraph | null
}

export type EditorOpType =
  | 'setGraph'
  | 'addNode'
  | 'addLoopZone'
  | 'quickAdd'
  | 'moveNode'
  | 'connect'
  | 'deleteNode'
  | 'deleteEdge'
  | 'moveMany'
  | 'updateNode'
  | 'renameZone'
  | 'setSelection'
  | 'copy'
  | 'paste'

export interface EditorOp {
  type: EditorOpType
  apply: (graph: EditorGraph) => EditorGraph
}

export const NON_HISTORIC = new Set<EditorOpType>(['setSelection', 'copy', 'setGraph'])

export function applyOp(graph: EditorGraph, op: EditorOp): EditorGraph {
  return op.apply(graph)
}

export const editorOps = {
  setGraph: (nodes: ChainNode[], edges: ChainEdge[]): EditorOp => ({
    type: 'setGraph',
    apply: g => ({ ...g, nodes, edges }),
  }),
  addNode: (kind: ChainNodeKind, pos: [number, number], extra?: Partial<ChainNode>): EditorOp => ({
    type: 'addNode',
    apply: g => ({ ...g, nodes: addNodeOfKind(g.nodes, kind, pos, extra) }),
  }),
  quickAdd: (item: QuickAddItem, pos: [number, number]): EditorOp => ({
    type: 'quickAdd',
    apply: g => applyOp(g, quickAddOp(item, pos)),
  }),
  addLoopZone: (pos: [number, number]): EditorOp => ({
    type: 'addLoopZone',
    apply: g => ({ ...g, nodes: [...g.nodes, ...makeLoopZone(reservedIds(g.nodes), pos)] }),
  }),
  connect: (edge: ChainEdge, workspace: WorkspaceLookup): EditorOp => ({
    type: 'connect',
    apply: g => ({ ...g, edges: connectEdge(g.nodes, g.edges, edge, workspace) }),
  }),
  deleteNode: (id: string): EditorOp => ({
    type: 'deleteNode',
    apply: g => {
      const { nodes, edges } = deleteNode(g.nodes, g.edges, id)
      return { ...g, nodes, edges, selectedIds: g.selectedIds.filter(x => x !== id) }
    },
  }),
  deleteEdge: (edge: ChainEdge): EditorOp => ({
    type: 'deleteEdge',
    apply: g => ({ ...g, edges: deleteEdge(g.edges, edge) }),
  }),
  moveMany: (updates: { id: string; pos: [number, number] }[]): EditorOp => ({
    type: 'moveMany',
    apply: g => ({
      ...g,
      nodes: moveMany(g.nodes, updates),
    }),
  }),
  moveNode: (id: string, pos: [number, number]): EditorOp => ({
    type: 'moveNode',
    apply: g => ({ ...g, nodes: updateNode(g.nodes, id, adoptOnDrop(g.nodes, id, pos)) }),
  }),
  updateNode: (id: string, patch: Partial<ChainNode>): EditorOp => ({
    type: 'updateNode',
    apply: g => ({
      ...g,
      nodes: updateNode(g.nodes, id, patch),
    }),
  }),
  renameZone: (oldZone: string, newZone: string): EditorOp => ({
    type: 'renameZone',
    apply: g => ({
      ...g,
      nodes: renameZone(g.nodes, oldZone, newZone),
    }),
  }),
  setSelection: (ids: string[]): EditorOp => ({
    type: 'setSelection',
    apply: g => {
      // #115: Identity bail-out for React Flow re-emits to prevent render churn.
      const a = g.selectedIds
      const b = ids
      if (a.length === b.length && a.every((id, i) => id === b[i])) return g
      return { ...g, selectedIds: b }
    },
  }),
  copy: (ids: string[]): EditorOp => ({
    type: 'copy',
    apply: g => ({ ...g, clipboard: copySubgraph(g.nodes, g.edges, ids) }),
  }),
  paste: (): EditorOp => ({
    type: 'paste',
    apply: g => {
      if (!g.clipboard) return g
      const { nodes, edges, newIds } = pasteSubgraph(g.clipboard, reservedIds(g.nodes), [40, 40])
      return { ...g, nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges], selectedIds: newIds }
    },
  }),
  undo: () => ({ type: 'undo' as const }),
  redo: () => ({ type: 'redo' as const }),
}

// A dragged connection becomes an edge unless validation would reject its shape.
export function edgeFromConnection(c: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }): ChainEdge | null {
  const edge: ChainEdge = { fromNode: c.source, fromSocket: c.sourceHandle ?? '', toNode: c.target, toSocket: c.targetHandle ?? '' }
  return edgeShapeError(edge) ? null : edge
}
