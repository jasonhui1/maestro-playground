import { ChainDef, ChainNode, ChainNodeKind, AgentDef, SkillDef, ToolDef, ZoneStateEntry } from './types'
import { agentSlots, DICE_SOCKET, socketKey } from './tokens'
import { ENTITY_DIRS } from './entityDirs'
import { agentPartSockets } from './tools/parts'
import { toolNodeInputs } from './tools/spec'

/** How deep subchains may nest before a run refuses to go further. */
export const MAX_SUBCHAIN_DEPTH = 10

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

/** How an edge reads this kind's output sockets; see "Socket read" in CONTEXT.md (#166). */
export type OutputRead = 'seed' | 'context' | 'param' | 'pass-through' | 'keyed' | 'sectioned'

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
  read: OutputRead
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
    ...agentSlots(a).map(name => ({ name })),
    ...agentPartSockets(a, tools).map(({ socket }) => ({ name: socket, optional: true })),
  ]
}

function agentOutputs(node: ChainNode, { agents }: WorkspaceLookup): string[] {
  const slug = agentSlugOf(node)
  const a = slug ? agents.find(x => x.slug === slug) : undefined
  const sockets = ['output', ...(a?.outputs ?? []).map(s => socketKey(s.name)), ...(a?.dice ? [DICE_SOCKET] : [])]
  return Array.from(new Set(sockets))
}

const registry: Record<ChainNodeKind, NodeKindDescriptor> = {
  seed: {
    kind: 'seed',
    acceptsInputs: false,
    acceptsLiterals: false,
    zoneRole: 'none',
    read: 'seed',
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
    read: 'context',
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
    read: 'param',
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
    read: 'sectioned',
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
    read: 'sectioned',
    inputs: agentInputs,
    outputs: agentOutputs,
    fields: [
      { key: 'agent', codec: 'string', ref: 'agent' },
      { key: 'skills!', codec: 'stringList', ref: 'skill' },
      { key: 'skills+', codec: 'stringList', ref: 'skill' },
    ],
    palette: { label: 'Decider', category: 'Agents', order: 21 },
  },
  tool: {
    kind: 'tool',
    acceptsInputs: true,
    // Its sockets read only wired values (#157).
    acceptsLiterals: false,
    zoneRole: 'body',
    read: 'sectioned',
    inputs: (node, { tools = [] }) => {
      const tool = tools.find(t => node.kind === 'tool' && t.name === node.tool)
      return tool ? toolNodeInputs(tool).map(name => ({ name, optional: true })) : []
    },
    outputs: () => ['output'],
    fields: [{ key: 'tool', codec: 'string', ref: 'tool' }],
    palette: { label: 'Tool', category: 'Tools', order: 25 },
  },
  gate: {
    kind: 'gate',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'none',
    read: 'pass-through',
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
    read: 'pass-through',
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
    read: 'keyed',
    inputs: (node, { chain }) => zoneStateOf(node, chain).map(state => ({ name: zoneStateName(state) })),
    outputs: (node, { chain }) => zoneStateOf(node, chain).map(zoneStateName),
    fields: [{ key: 'state', codec: 'stateList' }],
  },
  'loop-end': {
    kind: 'loop-end',
    acceptsInputs: true,
    acceptsLiterals: false,
    zoneRole: 'boundary',
    read: 'keyed',
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
    read: 'keyed',
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
    read: 'sectioned',
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
    read: 'sectioned',
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
    read: 'sectioned',
    inputs: () => [{ name: 'in' }],
    outputs: () => ['output'],
    fields: [{ key: 'prompt', codec: 'string' }],
    palette: { label: 'Hold', category: 'Control flow', order: 33 },
  },
}

/** One persisted field's value off a node; the descriptor's `fields` list is what makes the key valid. */
export function fieldValue(node: ChainNode, field: FieldDescriptor): unknown {
  return (node as unknown as Record<string, unknown>)[field.key]
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

/** A compound palette entry (drops a paired loop-start + loop-end), not a node kind, so no descriptor holds it. */
export const LOOP_ZONE_PALETTE: PaletteEntry = { label: 'Loop zone', category: 'Loop', order: 40 }

export interface PaletteGroup<T> { category: string; items: T[] }

/**
 * Groups entries by category, categories ordered by their lowest `order` (a category nobody listed
 * still appears). Items keep the order given, so a search's relevance ranking survives.
 */
export function paletteGroups<T extends { category: string; order: number }>(items: T[]): PaletteGroup<T>[] {
  const groups = new Map<string, PaletteGroup<T> & { order: number }>()
  for (const item of items) {
    const group = groups.get(item.category) ?? { category: item.category, items: [], order: item.order }
    group.items.push(item)
    group.order = Math.min(group.order, item.order)
    groups.set(item.category, group)
  }
  return Array.from(groups.values()).sort((a, b) => a.order - b.order).map(({ category, items }) => ({ category, items }))
}

export const allKinds: ChainNodeKind[] = Object.keys(registry) as ChainNodeKind[]

export const allFields: FieldDescriptor[] = (() => {
  const seen = new Map<string, FieldDescriptor>()
  for (const descriptor of Object.values(registry)) {
    for (const f of descriptor.fields) if (!seen.has(f.key)) seen.set(f.key, f)
  }
  return Array.from(seen.values())
})()
