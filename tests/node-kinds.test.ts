import assert from 'node:assert'
import { kindOf, WorkspaceLookup, FieldCodec } from '../lib/nodeKinds'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { chainToData, serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'
import { ChainDef, ChainNode, ChainNodeKind, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string, outputs = [{ name: 'output' }]): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs, inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('writer', 'Write {topic} for {audience}', [{ name: 'output' }, { name: 'Summary' }])]

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'ctx', kind: 'context', file: 'notes' },
    { id: 'w', kind: 'agent', agent: 'writer' },
    { id: 'd', kind: 'decider', agent: 'writer' },
    { id: 'g', kind: 'gate', condition: 'x' },
    { id: 'b', kind: 'branch', cases: [{ label: 'urgent', condition: 'x' }], default: 'other' },
    { id: 'ls', kind: 'loop-start', zone: 'z1', state: ['draft'] },
    { id: 'le', kind: 'loop-end', zone: 'z1', until: 'x', maxIterations: 3 },
    { id: 'rep', kind: 'report' },
  ],
  edges: [],
}

const ref: ChainDef = {
  slug: 'triage', name: 'Triage', description: '', filePath: '',
  nodes: [{ id: 'seedA', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'x' }],
  edges: [],
  inputs: [{ name: 'topic', node: 'seedA' }],
  outputs: [{ name: 'verdict', node: 'w' }, { name: 'summary', node: 'w', socket: 'summary' }],
}
const bare: ChainDef = { slug: 'bare', name: 'Bare', description: '', filePath: '', nodes: [], edges: [] }
const sub: ChainNode = { id: 'sub', kind: 'subchain', subchain: 'triage' }
const sub2: ChainNode = { id: 's2', kind: 'subchain', subchain: 'bare' }

// --- registry inputs/outputs parity vs lib/nodeSockets.ts ---
function assertParity(node: ChainNode, workspace: WorkspaceLookup) {
  const descriptor = kindOf(node.kind)
  const gotInputs = descriptor.inputs(node, workspace).map(s => s.name)
  const gotOutputs = descriptor.outputs(node, workspace)
  const wantInputs = inputSocketsOf(node, workspace.chain, workspace.agents, workspace.chains)
  const wantOutputs = outputSocketsOf(node, workspace.chain, workspace.agents, workspace.chains)
  assert.deepStrictEqual(gotInputs, wantInputs, `inputs mismatch for ${node.kind}`)
  assert.deepStrictEqual(gotOutputs, wantOutputs, `outputs mismatch for ${node.kind}`)
}

const workspace: WorkspaceLookup = { chain, agents, chains: [] }
for (const node of chain.nodes) assertParity(node, workspace)

const hostWorkspace: WorkspaceLookup = { chain: { slug: 'host', name: 'Host', description: '', filePath: '', nodes: [], edges: [] }, agents: [], chains: [ref] }
assertParity(sub, hostWorkspace)
const bareWorkspace: WorkspaceLookup = { ...hostWorkspace, chains: [bare] }
assertParity(sub2, bareWorkspace)

// --- optional: true only on subchain inputs ---
assert.deepStrictEqual(kindOf('subchain').inputs(sub, hostWorkspace), [{ name: 'topic', optional: true }])
for (const kind of ['seed', 'context', 'agent', 'decider', 'gate', 'branch', 'loop-start', 'loop-end', 'report'] as ChainNodeKind[]) {
  const node = chain.nodes.find(n => n.kind === kind)!
  for (const s of kindOf(kind).inputs(node, workspace)) assert.strictEqual(s.optional, undefined, `${kind} input marked optional`)
}

// --- fields parity: descriptors vs what serializeChain writes / parseChain reads ---
// Build one fully-populated node per kind (every descriptor field set to a
// codec-typical value), serialize it, and assert the emitted keys are exactly
// the descriptor's field keys — then parse back and assert each value survives
// with its codec's type. No hand-copied field lists: serializeChain/parseChain
// themselves are the oracle.
const sampleValue: Record<FieldCodec, unknown> = {
  string: 'sample',
  number: 3,
  stringList: ['a', 'b'],
  cases: [{ label: 'l1', condition: 'c1' }],
}
const COMMON_KEYS = new Set(['id', 'kind', 'pos', 'zone'])
const allKinds: ChainNodeKind[] = ['seed', 'context', 'agent', 'decider', 'gate', 'branch', 'loop-start', 'loop-end', 'subchain', 'report']

const populated: ChainNode[] = allKinds.map((kind, i) => {
  const node: Record<string, unknown> = { id: `n${i}`, kind, pos: [i, i * 2] as [number, number], zone: 'z1' }
  for (const f of kindOf(kind).fields) node[f.key] = sampleValue[f.codec]
  return node as ChainNode
})

const serialized = chainToData({ name: 'parity' }, populated, [])
for (const [i, kind] of allKinds.entries()) {
  const emitted = Object.keys((serialized.nodes as Record<string, unknown>[])[i]).filter(k => !COMMON_KEYS.has(k)).sort()
  const declared = kindOf(kind).fields.map(f => f.key).sort()
  assert.deepStrictEqual(emitted, declared, `serializeChain keys mismatch for ${kind}`)
}

const reparsed = parseChainContent(serializeChain({ name: 'parity' }, populated, []), 'parity')
for (const [i, kind] of allKinds.entries()) {
  const node = reparsed.nodes[i] as unknown as Record<string, unknown>
  for (const f of kindOf(kind).fields) {
    assert.deepStrictEqual(node[f.key], sampleValue[f.codec], `parseChain lost/coerced ${kind}.${f.key} (codec ${f.codec})`)
  }
}

// --- palette entries match components/editor/NodePalette.tsx ITEMS ---
const expectedPalette: Partial<Record<ChainNodeKind, { label: string; category: string }>> = {
  seed: { label: 'Seed', category: 'Sources' },
  context: { label: 'Context', category: 'Sources' },
  agent: { label: 'Agent', category: 'Agents' },
  decider: { label: 'Decider', category: 'Agents' },
  gate: { label: 'Gate', category: 'Control flow' },
  branch: { label: 'Branch', category: 'Control flow' },
  subchain: { label: 'Subchain', category: 'Composite' },
  report: { label: 'Report', category: 'Output' },
}
for (const [kind, entry] of Object.entries(expectedPalette)) {
  assert.deepStrictEqual(kindOf(kind as ChainNodeKind).palette, entry, `palette mismatch for ${kind}`)
}
assert.strictEqual(kindOf('loop-start').palette, undefined)
assert.strictEqual(kindOf('loop-end').palette, undefined)

console.log('✅ node-kinds tests passed')
