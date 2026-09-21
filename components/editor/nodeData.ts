import { ChainNode } from '@/lib/types'
import { NodeRunState } from '@/lib/runState'
import { SocketHandle } from '@/lib/nodeSockets'

export interface EditorNodeData {
  node: ChainNode
  /** Every socket the registry declares for this node, built by `socketHandles` (#114). */
  sockets: SocketHandle[]
  agents: { slug: string; name: string }[]
  contextFiles: { slug: string; name: string }[]
  run?: NodeRunState
  issues: string[]
  onChange: (patch: Partial<ChainNode>) => void
  onEditAgent?: (slug: string) => void
  onRunFromHere?: (id: string) => void
  chains: { slug: string; name: string }[]
  readOnly?: boolean
  wiredSockets?: Set<string>
  [key: string]: unknown
}

// The node variant for a given kind.
export type NodeOfKind<K extends ChainNode['kind']> = Extract<ChainNode, { kind: K }>

// EditorNodeData whose `node` is narrowed to specific kind(s). A node component
// types its props with this to declare which kind it renders; the `nodeType()`
// pairing helper in ChainCanvas then compiler-checks that the component is
// registered under a matching kind (a mis-wire becomes a type error).
export type EditorNodeDataOf<K extends ChainNode['kind']> = EditorNodeData & { node: NodeOfKind<K> }

export function statusDotClass(run?: NodeRunState): string {
  if (!run || run.status === 'idle') return 'bg-zinc-300'
  if (run.status === 'running') return 'bg-blue-500 animate-pulse'
  if (run.status === 'error') return 'bg-red-500'
  if (run.status === 'skipped') return 'bg-zinc-300'
  return 'bg-green-500'
}
