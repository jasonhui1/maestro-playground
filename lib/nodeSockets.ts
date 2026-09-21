import { ChainNode } from './types'
import { inputIsMulti, kindOf, WorkspaceLookup } from './nodeKinds'

/** One socket of a node, as the canvas needs to draw it and an edge needs to name it. */
export interface SocketHandle {
  /** The socket name; an edge's `fromSocket`/`toSocket` is this string. */
  id: string
  side: 'input' | 'output'
  /** An unwired optional input is not an error. Inputs only. */
  optional?: true
  /** This slot takes N incoming edges; every other takes one. Inputs only. */
  multi?: true
}

// The one reader of a descriptor's socket facts (#114, ADR-0001).
export function socketHandles(node: ChainNode, workspace: WorkspaceLookup): SocketHandle[] {
  const descriptor = kindOf(node.kind)
  return [
    ...descriptor.inputs(node, workspace).map((s): SocketHandle => ({
      id: s.name,
      side: 'input',
      ...(s.optional ? { optional: true as const } : {}),
      ...(inputIsMulti(s, descriptor) ? { multi: true as const } : {}),
    })),
    ...descriptor.outputs(node, workspace).map((name): SocketHandle => ({ id: name, side: 'output' })),
  ]
}

/** The handle for one named socket, or undefined while the name is still being typed. */
export function handleNamed(handles: SocketHandle[], side: SocketHandle['side'], id: string): SocketHandle | undefined {
  return handles.find(h => h.side === side && h.id === id)
}

export function inputHandles(handles: SocketHandle[]): SocketHandle[] {
  return handles.filter(h => h.side === 'input')
}

export function outputHandles(handles: SocketHandle[]): SocketHandle[] {
  return handles.filter(h => h.side === 'output')
}
