import { ChainNode, ChainEdge } from './types'
import {
  connectEdge, deleteNode as opDeleteNode, deleteEdge as opDeleteEdge,
  makeLoopZone, copySubgraph, pasteSubgraph, reservedIds, Subgraph,
} from './editorOps'

export interface EditorState {
  nodes: ChainNode[]
  edges: ChainEdge[]
  selectedIds: string[]
  clipboard: Subgraph | null
}

export type EditorAction =
  | { type: 'setGraph'; nodes: ChainNode[]; edges: ChainEdge[] }
  | { type: 'addNode'; node: ChainNode }
  | { type: 'addLoopZone'; pos: [number, number] }
  | { type: 'connect'; edge: ChainEdge }
  | { type: 'deleteNode'; id: string }
  | { type: 'deleteEdge'; edge: ChainEdge }
  | { type: 'moveNode'; id: string; pos: [number, number] }
  | { type: 'moveMany'; updates: { id: string; pos: [number, number] }[] }
  | { type: 'updateNode'; id: string; patch: Partial<ChainNode> }
  | { type: 'setSelection'; ids: string[] }
  | { type: 'copy'; ids: string[] }
  | { type: 'paste' }

export const NON_HISTORIC = new Set<string>(['setSelection', 'copy', 'setGraph'])

export function applyEditorAction(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setGraph':
      return { ...state, nodes: action.nodes, edges: action.edges }
    case 'addNode':
      return { ...state, nodes: [...state.nodes, action.node] }
    case 'addLoopZone':
      return { ...state, nodes: [...state.nodes, ...makeLoopZone(reservedIds(state.nodes), action.pos)] }
    case 'connect': {
      const dst = state.nodes.find(n => n.id === action.edge.toNode)
      return { ...state, edges: connectEdge(state.edges, action.edge, dst?.kind === 'join') }
    }
    case 'deleteNode': {
      const { nodes, edges } = opDeleteNode(state.nodes, state.edges, action.id)
      return { ...state, nodes, edges, selectedIds: state.selectedIds.filter(x => x !== action.id) }
    }
    case 'deleteEdge':
      return { ...state, edges: opDeleteEdge(state.edges, action.edge) }
    case 'moveNode':
      return { ...state, nodes: state.nodes.map(n => n.id === action.id ? { ...n, pos: action.pos } : n) }
    case 'moveMany': {
      const m = new Map(action.updates.map(u => [u.id, u.pos]))
      return { ...state, nodes: state.nodes.map(n => m.has(n.id) ? { ...n, pos: m.get(n.id)! } : n) }
    }
    case 'updateNode':
      return { ...state, nodes: state.nodes.map(n => n.id === action.id ? { ...n, ...action.patch } : n) }
    case 'setSelection': {
      // No-op guard: React Flow re-emits selection on every node sync. Returning the
      // same state when the id set is unchanged lets the history reducer bail out, so a
      // benign re-emit can't churn renders into a "Maximum update depth exceeded" loop.
      const a = state.selectedIds, b = action.ids
      if (a.length === b.length && a.every((id, i) => id === b[i])) return state
      return { ...state, selectedIds: b }
    }
    case 'copy':
      return { ...state, clipboard: copySubgraph(state.nodes, state.edges, action.ids) }
    case 'paste': {
      if (!state.clipboard) return state
      const { nodes, edges, newIds } = pasteSubgraph(state.clipboard, reservedIds(state.nodes), [40, 40])
      return { ...state, nodes: [...state.nodes, ...nodes], edges: [...state.edges, ...edges], selectedIds: newIds }
    }
    default:
      return state
  }
}
