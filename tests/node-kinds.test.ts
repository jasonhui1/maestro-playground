import assert from 'node:assert'
import { kindOf, WorkspaceLookup } from '../lib/nodeKinds'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
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

// --- fields match serializeChain.ts / parseChain.ts persisted keys ---
const expectedFields: Record<ChainNodeKind, string[]> = {
  seed: [],
  context: ['file'],
  agent: ['agent'],
  decider: ['agent'],
  gate: ['condition'],
  branch: ['cases', 'default'],
  'loop-start': ['state'],
  'loop-end': ['until', 'maxIterations'],
  subchain: ['subchain'],
  report: [],
}
for (const [kind, keys] of Object.entries(expectedFields)) {
  assert.deepStrictEqual(kindOf(kind as ChainNodeKind).fields.map(f => f.key), keys, `field keys mismatch for ${kind}`)
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
