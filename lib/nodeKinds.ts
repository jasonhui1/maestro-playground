import { ChainDef, ChainNode, ChainNodeKind, AgentDef } from './types'
import { parseSlots } from './slots'
import { slugify } from './graph'
import { ENTITY_DIRS } from './entityDirs'

export interface WorkspaceLookup {
  chain: ChainDef
  agents: AgentDef[]
  chains: ChainDef[]
}

export interface InputSocket {
  name: string
  optional?: boolean
}

export type FieldCodec = 'string' | 'number' | 'stringList' | 'cases'

export interface FieldDescriptor {
  key: string
  codec: FieldCodec
  /** The workspace file type this field names by slug, for fields that hold a reference (#54). */
  ref?: keyof typeof ENTITY_DIRS
}

export interface PaletteEntry {
  label: string
  category: string
}

export interface NodeKindDescriptor {
  kind: ChainNodeKind
  /** Whether this kind can ever expose input sockets, independent of any one node's current data. */
  acceptsInputs: boolean
  /** Whether this kind's input sockets each accept N incoming edges (join only; every other slot takes one). */
  multiInput?: boolean
  inputs(node: ChainNode, workspace: WorkspaceLookup): InputSocket[]
  outputs(node: ChainNode, workspace: WorkspaceLookup): string[]
  fields: FieldDescriptor[]
  palette?: PaletteEntry
}

function zoneStateOf(node: ChainNode, chain: ChainDef): string[] {
  if (!node.zone) return []
  const start = chain.nodes.find(n => n.kind === 'loop-start' && n.zone === node.zone)
  return (start?.kind === 'loop-start' ? start.state : undefined) ?? []
}

// agent + decider both carry the `agent` slug; other kinds don't.
export function agentSlugOf(node: ChainNode): string | undefined {
  return node.kind === 'agent' || node.kind === 'decider' ? node.agent : undefined
}

// `skills!` overrides, `skills+` extends, neither leaves it unchanged (ADR-0010).
export function resolveNodeSkills(node: ChainNode, agentSkills: string[]): string[] {
  if (node.kind !== 'agent' && node.kind !== 'decider') return agentSkills
  if (node['skills!'] !== undefined) return node['skills!']
  if (node['skills+'] !== undefined) return [...agentSkills, ...node['skills+']]
  return agentSkills
}

function agentInputs(node: ChainNode, { agents }: WorkspaceLookup): InputSocket[] {
  const slug = agentSlugOf(node)
  const a = slug ? agents.find(x => x.slug === slug) : undefined
  return a ? parseSlots(a.systemPrompt).map(name => ({ name })) : []
}

function agentOutputs(node: ChainNode, { agents }: WorkspaceLookup): string[] {
  const slug = agentSlugOf(node)
  const a = slug ? agents.find(x => x.slug === slug) : undefined
  const sockets = ['output', ...(a?.outputs ?? []).map(s => slugify(s.name))]
  return Array.from(new Set(sockets))
}

const registry: Record<ChainNodeKind, NodeKindDescriptor> = {
  seed: {
    kind: 'seed',
    acceptsInputs: false,
    inputs: () => [],
    outputs: () => ['output'],
    fields: [],
    palette: { label: 'Seed', category: 'Sources' },
  },
  context: {
    kind: 'context',
    acceptsInputs: false,
    inputs: () => [],
    outputs: () => ['output'],
    fields: [{ key: 'file', codec: 'string', ref: 'context' }],
    palette: { label: 'Context', category: 'Sources' },
  },
  agent: {
    kind: 'agent',
    acceptsInputs: true,
    inputs: agentInputs,
    outputs: agentOutputs,
    fields: [
      { key: 'agent', codec: 'string', ref: 'agent' },
      { key: 'skills!', codec: 'stringList', ref: 'skill' },
      { key: 'skills+', codec: 'stringList', ref: 'skill' },
    ],
    palette: { label: 'Agent', category: 'Agents' },
  },
  decider: {
    kind: 'decider',
    acceptsInputs: true,
    inputs: agentInputs,
    outputs: agentOutputs,
    fields: [
      { key: 'agent', codec: 'string', ref: 'agent' },
      { key: 'skills!', codec: 'stringList', ref: 'skill' },
      { key: 'skills+', codec: 'stringList', ref: 'skill' },
    ],
    palette: { label: 'Decider', category: 'Agents' },
  },
  gate: {
    kind: 'gate',
    acceptsInputs: true,
    inputs: () => [{ name: 'in' }],
    outputs: () => ['output'],
    fields: [{ key: 'condition', codec: 'string' }],
    palette: { label: 'Gate', category: 'Control flow' },
  },
  branch: {
    kind: 'branch',
    acceptsInputs: true,
    inputs: () => [{ name: 'in' }],
    outputs: node =>
      node.kind === 'branch'
        ? [...(node.cases ?? []).map(c => c.label), ...(node.default ? [node.default] : [])]
        : [],
    fields: [
      { key: 'cases', codec: 'cases' },
      { key: 'default', codec: 'string' },
    ],
    palette: { label: 'Branch', category: 'Control flow' },
  },
  'loop-start': {
    kind: 'loop-start',
    acceptsInputs: true,
    inputs: (node, { chain }) => zoneStateOf(node, chain).map(name => ({ name })),
    outputs: (node, { chain }) => zoneStateOf(node, chain),
    fields: [{ key: 'state', codec: 'stringList' }],
  },
  'loop-end': {
    kind: 'loop-end',
    acceptsInputs: true,
    inputs: (node, { chain }) => zoneStateOf(node, chain).map(name => ({ name })),
    outputs: (node, { chain }) => zoneStateOf(node, chain),
    fields: [
      { key: 'until', codec: 'string' },
      { key: 'maxIterations', codec: 'number' },
    ],
  },
  subchain: {
    kind: 'subchain',
    acceptsInputs: true,
    inputs: (node, { chains }) => {
      const slug = node.kind === 'subchain' ? node.subchain : undefined
      const ref = chains.find(c => c.slug === slug)
      return (ref?.inputs ?? []).map(p => ({ name: p.name, optional: true }))
    },
    outputs: (node, { chains }) => {
      const slug = node.kind === 'subchain' ? node.subchain : undefined
      const ref = chains.find(c => c.slug === slug)
      const outs = (ref?.outputs ?? []).map(p => p.name)
      return outs.length ? outs : ['output']
    },
    fields: [{ key: 'subchain', codec: 'string', ref: 'chain' }],
    palette: { label: 'Subchain', category: 'Composite' },
  },
  join: {
    kind: 'join',
    acceptsInputs: true,
    multiInput: true,
    inputs: () => [{ name: 'in' }],
    outputs: () => ['output'],
    fields: [],
    palette: { label: 'Join', category: 'Control flow' },
  },
  report: {
    kind: 'report',
    acceptsInputs: true,
    inputs: () => [{ name: 'in' }],
    outputs: () => [],
    fields: [],
    palette: { label: 'Report', category: 'Output' },
  },
}

export function kindOf(kind: ChainNodeKind): NodeKindDescriptor {
  return registry[kind]
}

export const allKinds: ChainNodeKind[] = Object.keys(registry) as ChainNodeKind[]

export const allFields: FieldDescriptor[] = (() => {
  const seen = new Map<string, FieldDescriptor>()
  for (const descriptor of Object.values(registry)) {
    for (const f of descriptor.fields) if (!seen.has(f.key)) seen.set(f.key, f)
  }
  return Array.from(seen.values())
})()
