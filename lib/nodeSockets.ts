import { ChainNode, ChainNodeKind } from './types'
import { agentSlugOf, inputIsMulti, kindOf, WorkspaceLookup } from './nodeKinds'
import { DICE_SOCKET, isWholeOutput, socketKey } from './tokens'
import { unreachable } from './unreachable'

/** How one output socket reads, per its kind's `read` fact — the reader's vocabulary (#166). */
export type SocketReading = 'whole' | 'section' | 'roll' | 'keyed'

/** A `sectioned` socket: `dice` is the roll only on a node that rolls, else a section like any other. */
export function sectionedReading(socket: string, rolls: boolean): 'whole' | 'section' | 'roll' {
  if (isWholeOutput(socket)) return 'whole'
  return rolls && socketKey(socket) === DICE_SOCKET ? 'roll' : 'section'
}

export function socketReading(kind: ChainNodeKind, socket: string, rolls: boolean): SocketReading {
  const read = kindOf(kind).read
  switch (read) {
    case 'seed': case 'context': case 'param': case 'pass-through': return 'whole'
    case 'keyed': return 'keyed'
    case 'sectioned': return sectionedReading(socket, rolls)
    default: return unreachable(read)
  }
}

/** One socket of a node, as the canvas needs to draw it and an edge needs to name it. */
export interface SocketHandle {
  /** The socket name; an edge's `fromSocket`/`toSocket` is this string. */
  id: string
  side: 'input' | 'output'
  /** An unwired optional input is not an error. Inputs only. */
  optional?: true
  /** This slot takes N incoming edges; every other takes one. Inputs only. */
  multi?: true
  /** What an edge reading this socket receives, so the canvas never guesses a section (#166). Outputs only. */
  reads?: SocketReading
}

// The one reader of a descriptor's socket facts (#114, ADR-0001).
export function socketHandles(node: ChainNode, workspace: WorkspaceLookup): SocketHandle[] {
  const descriptor = kindOf(node.kind)
  const slug = agentSlugOf(node)
  const rolls = slug !== undefined && workspace.agents.some(a => a.slug === slug && a.dice)
  return [
    ...descriptor.inputs(node, workspace).map((s): SocketHandle => ({
      id: s.name,
      side: 'input',
      ...(s.optional ? { optional: true as const } : {}),
      ...(inputIsMulti(s, descriptor) ? { multi: true as const } : {}),
    })),
    ...descriptor.outputs(node, workspace).map((name): SocketHandle => ({ id: name, side: 'output', reads: socketReading(node.kind, name, rolls) })),
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
