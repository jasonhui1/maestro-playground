import { ChainNode, ChainEdge } from './types'
import {
  connectEdge, deleteNode as opDeleteNode, deleteEdge as opDeleteEdge,
  makeLoopZone, copySubgraph, pasteSubgraph, Subgraph,
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
      return { ...state, nodes: [...state.nodes, ...makeLoopZone(state.nodes.map(n => n.id), action.pos)] }
    case 'connect':
      return { ...state, edges: connectEdge(state.edges, action.edge) }
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
    case 'setSelection':
      return { ...state, selectedIds: action.ids }
    case 'copy':
      return { ...state, clipboard: copySubgraph(state.nodes, state.edges, action.ids) }
    case 'paste': {
      if (!state.clipboard) return state
      const { nodes, edges, newIds } = pasteSubgraph(state.clipboard, state.nodes.map(n => n.id), [40, 40])
      return { ...state, nodes: [...state.nodes, ...nodes], edges: [...state.edges, ...edges], selectedIds: newIds }
    }
    default:
      return state
  }
}
