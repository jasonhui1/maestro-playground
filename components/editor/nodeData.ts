import { ChainNode } from '@/lib/types'
import { NodeRunState } from '@/lib/runState'

export interface EditorNodeData {
  node: ChainNode
  inputs: string[]
  outputs: string[]
  agents: { slug: string; name: string }[]
  contextFiles: { slug: string; name: string }[]
  run?: NodeRunState
  issues: string[]
  onChange: (patch: Partial<ChainNode>) => void
  [key: string]: unknown
}

export function statusDotClass(run?: NodeRunState): string {
  if (!run || run.status === 'idle') return 'bg-zinc-300'
  if (run.status === 'running') return 'bg-blue-500 animate-pulse'
  if (run.status === 'error') return 'bg-red-500'
  if (run.status === 'skipped') return 'bg-zinc-300'
  return 'bg-green-500'
}
