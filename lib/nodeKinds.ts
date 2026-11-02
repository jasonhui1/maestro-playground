import { ChainDef, ChainNode, ChainNodeKind, AgentDef, SkillDef, ToolDef, ZoneStateEntry } from './types'
import { promptSlots, socketKey } from './tokens'
import { ENTITY_DIRS } from './entityDirs'
import { agentPartSockets } from './tools/parts'

export interface WorkspaceLookup {
  chain: ChainDef
  agents: AgentDef[]
  chains: ChainDef[]
  /** Without it an agent node shows no tool part sockets (#149). */
  tools?: ToolDef[]
}

export interface InputSocket {
  name: string
  optional?: boolean
  /** This socket accepts N incoming edges instead of one. */
  multi?: boolean
}

export type FieldCodec = 'string' | 'number' | 'stringList' | 'stateList' | 'cases'

export interface FieldDescriptor {
  key: string
  codec: FieldCodec
  /** The workspace file type this field names by slug, for fields that hold a reference (#54). */
  ref?: keyof typeof ENTITY_DIRS
}

export interface PaletteEntry {
  label: string
  category: string
  /** Sort key across the whole palette: a category sits where its first entry does, entries sort within it. */
  order: number
}

/** `body` runs each round, `boundary` frames the zone, `none` cannot sit inside a loop zone. */
export type ZoneRole = 'body' | 'boundary' | 'none'

export interface NodeKindDescriptor {
  kind: ChainNodeKind
  /** Whether this kind can ever expose input sockets, independent of any one node's current data. */
  acceptsInputs: boolean
  /** Whether every input socket on this kind accepts N incoming edges (`join`). */
  multiInput?: boolean
  /** Whether a node of this kind may carry a saved literal under `inputs[slot]`. */
  acceptsLiterals: boolean
  /** The executor's zone body runs only the `body` kinds; any other kind in a zone never runs. */
  zoneRole: ZoneRole
  inputs(node: ChainNode, workspace: WorkspaceLookup): InputSocket[]
  outputs(node: ChainNode, workspace: WorkspaceLookup): string[]
  fields: FieldDescriptor[]
  palette?: PaletteEntry
}

export function zoneStateOf(node: ChainNode, chain: ChainDef): ZoneStateEntry[] {
  if (!node.zone) return []
  const start = chain.nodes.find(n => n.kind === 'loop-start' && n.zone === node.zone)
  return (start?.kind === 'loop-start' ? start.state : undefined) ?? []
}

export function zoneStateName(state: ZoneStateEntry): string {
  return typeof state === 'string' ? state : state.name
}

function accumulatingStateSocket(state: ZoneStateEntry): InputSocket {
  return {
    name: zoneStateName(state),
    ...(typeof state !== 'string' && state.accumulate ? { multi: true } : {}),
  }
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

// Shared by validateChain (pre-run) and injectSkills (run-time backstop), so the two
// checks can't drift apart (#132).
export function unknownSkillNames(names: string[], allSkills: SkillDef[]): string[] {
  const known = new Set(allSkills.map(s => s.name))
  return names.filter(name => !known.has(name))
}

// A part socket is optional: unwired and unset, the tool's default or the agent fills it (#149).
function agentInputs(node: ChainNode, { agents, tools = [] }: WorkspaceLookup): InputSocket[] {
  const slug = agentSlugOf(node)
  const a = slug ? agents.find(x => x.slug === slug) : undefined
  if (!a) return []
  return [
    ...promptSlots(a.systemPrompt).map(name => ({ name })),
    ...agentPartSockets(a, tools).map(({ socket }) => ({ name: socket, optional: true })),
  ]
}

function agentOutputs(node: ChainNode, { agents }: WorkspaceLookup): string[] {
  const slug = agentSlugOf(node)
  const a = slug ? agents.find(x => x.slug === slug) : undefined
  const sockets = ['output', ...(a?.outputs ?? []).map(s => socketKey(s.name))]
  return Array.from(new Set(sockets))
}

const registry: Record<ChainNodeKind, NodeKindDescriptor> = {
  seed: {
    kind: 'seed',
    acceptsInputs: false,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [],
    outputs: () => ['output'],
    fields: [],
    palette: { label: 'Seed', category: 'Sources', order: 10 },
  },
  context: {
    kind: 'context',
    acceptsInputs: false,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [],
    outputs: () => ['output'],
    fields: [{ key: 'file', codec: 'string', ref: 'context' }],
    palette: { label: 'Context', category: 'Sources', order: 11 },
  },
  // Options live only on ChainDef.parameter — a single source, no field to desync (#69).
  param: {
    kind: 'param',
    acceptsInputs: false,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [],
    outputs: () => ['output'],
    fields: [],
    palette: { label: 'Parameter', category: 'Sources', order: 12 },
  },
  agent: {
    kind: 'agent',
    acceptsInputs: true,
    acceptsLiterals: true,
    zoneRole: 'body',
    inputs: agentInputs,
    outputs: agentOutputs,
    fields: [
      { key: 'agent', codec: 'string', ref: 'agent' },
      { key: 'skills!', codec: 'stringList', ref: 'skill' },
      { key: 'skills+', codec: 'stringList', ref: 'skill' },
    ],
    palette: { label: 'Agent', category: 'Agents', order: 20 },
  },
  decider: {
    kind: 'decider',
    acceptsInputs: true,
    acceptsLiterals: true,
    zoneRole: 'body',
    inputs: agentInputs,
    outputs: agentOutputs,
    fields: [
      { key: 'agent', codec: 'string', ref: 'agent' },
      { key: 'skills!', codec: 'stringList', ref: 'skill' },
      { key: 'skills+', codec: 'stringList', ref: 'skill' },
    ],
    palette: { label: 'Decider', category: 'Agents', order: 21 },
  },
  gate: {
    kind: 'gate',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [{ name: 'in' }],
    outputs: () => ['output'],
    fields: [{ key: 'condition', codec: 'string' }],
    palette: { label: 'Gate', category: 'Control flow', order: 30 },
  },
  branch: {
    kind: 'branch',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [{ name: 'in' }],
    outputs: node =>
      node.kind === 'branch'
        ? [...(node.cases ?? []).map(c => c.label), ...(node.default ? [node.default] : [])]
        : [],
    fields: [
      { key: 'cases', codec: 'cases' },
      { key: 'default', codec: 'string' },
    ],
    palette: { label: 'Branch', category: 'Control flow', order: 31 },
  },
  'loop-start': {
    kind: 'loop-start',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'boundary',
    inputs: (node, { chain }) => zoneStateOf(node, chain).map(state => ({ name: zoneStateName(state) })),
    outputs: (node, { chain }) => zoneStateOf(node, chain).map(zoneStateName),
    fields: [{ key: 'state', codec: 'stateList' }],
  },
  'loop-end': {
    kind: 'loop-end',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'boundary',
    inputs: (node, { chain }) => zoneStateOf(node, chain).map(accumulatingStateSocket),
    outputs: (node, { chain }) => zoneStateOf(node, chain).map(zoneStateName),
    fields: [
      { key: 'until', codec: 'string' },
      { key: 'maxIterations', codec: 'number' },
    ],
  },
  subchain: {
    kind: 'subchain',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
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
    palette: { label: 'Subchain', category: 'Composite', order: 50 },
  },
  join: {
    kind: 'join',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
    multiInput: true,
    inputs: () => [{ name: 'in' }],
    outputs: () => ['output'],
    fields: [],
    palette: { label: 'Join', category: 'Control flow', order: 32 },
  },
  report: {
    kind: 'report',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [{ name: 'in' }],
    outputs: () => [],
    fields: [],
    palette: { label: 'Report', category: 'Output', order: 60 },
  },
  hold: {
    kind: 'hold',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
    inputs: () => [{ name: 'in' }],
    outputs: () => ['output'],
    fields: [{ key: 'prompt', codec: 'string' }],
    palette: { label: 'Hold', category: 'Control flow', order: 33 },
  },
}

export function kindOf(kind: ChainNodeKind): NodeKindDescriptor {
  return registry[kind]
}

export function inputIsMulti(input: InputSocket, descriptor: NodeKindDescriptor): boolean {
  return descriptor.multiInput === true || input.multi === true
}

export function inputAcceptsMany(node: ChainNode, socket: string, workspace: WorkspaceLookup): boolean {
  const descriptor = kindOf(node.kind)
  const input = descriptor.inputs(node, workspace).find(candidate => candidate.name === socket)
  return descriptor.multiInput === true || (input !== undefined && inputIsMulti(input, descriptor))
}

export interface PaletteGroup<T> { category: string; items: T[] }

/** Groups palette entries by category, ordered by `order`; a category nobody listed still appears. */
export function paletteGroups<T extends { category: string; order: number }>(items: T[]): PaletteGroup<T>[] {
  const groups = new Map<string, PaletteGroup<T>>()
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const group = groups.get(item.category) ?? { category: item.category, items: [] }
    group.items.push(item)
    groups.set(item.category, group)
  }
  return Array.from(groups.values())
}

export const allKinds: ChainNodeKind[] = Object.keys(registry) as ChainNodeKind[]

export const allFields: FieldDescriptor[] = (() => {
  const seen = new Map<string, FieldDescriptor>()
  for (const descriptor of Object.values(registry)) {
    for (const f of descriptor.fields) if (!seen.has(f.key)) seen.set(f.key, f)
  }
  return Array.from(seen.values())
})()
