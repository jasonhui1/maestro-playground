import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, name: string, prompt: string): AgentDef => ({
  slug, name, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [
  agent('w1', 'W1', 'W1: {task}'), agent('w2', 'W2', 'W2: {task}'),
  agent('w3', 'W3', 'W3: {task}'), agent('syn', 'SYN', 'SYN: {panel}'),
]
const noop = { onStart() {}, onToken() {}, onDone() {} }
const stub = (async (a: AgentDef, sys: string) => ({
  agentName: a.name, systemPrompt: sys, input: '', output: `out-${a.slug}`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
} as AgentOutput)) as never

const base = (edges: ChainDef['edges']): ChainDef => ({
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
    { id: 'j', kind: 'join' },
    { id: 'ns', kind: 'agent', agent: 'syn' },
  ],
  edges,
})
const seedTo = (n: string) => ({ fromNode: 'seed', fromSocket: 'output', toNode: n, toSocket: 'task' })
const toJoin = (n: string) => ({ fromNode: n, fromSocket: 'output', toNode: 'j', toSocket: 'in' })
const joinToSyn = { fromNode: 'j', fromSocket: 'output', toNode: 'ns', toSocket: 'panel' }

async function main() {
  // 1. all three live → labeled concat in EDGE-DECLARATION order; syn receives it
  const full = base([seedTo('n1'), seedTo('n2'), seedTo('n3'),
                     toJoin('n1'), toJoin('n2'), toJoin('n3'), joinToSyn])
  const r1 = await runChainGraph(full, agents, [], 'SEED', '/ws', noop, stub)
  const j = r1.find(r => r.nodeId === 'j')!
  assert.ok(j.output.includes('## W1') && j.output.includes('out-w1'), 'W1 block present')
  assert.ok(j.output.includes('## W2') && j.output.includes('## W3'), 'W2/W3 blocks present')
  assert.ok(j.output.indexOf('## W1') < j.output.indexOf('## W2')
         && j.output.indexOf('## W2') < j.output.indexOf('## W3'), 'blocks in edge order')
  const syn = r1.find(r => r.nodeId === 'ns')!
  assert.ok(syn.systemPrompt.includes('out-w1') && syn.systemPrompt.includes('out-w3'),
    'synthesizer received the concat')

  // 2. a dead input (n3 unwired) is DROPPED; the live ones remain
  const partial = base([seedTo('n1'), seedTo('n2'),   // n3 has no seed → n3 skipped
                        toJoin('n1'), toJoin('n2'), toJoin('n3'), joinToSyn])
  const r2 = await runChainGraph(partial, agents, [], 'SEED', '/ws', noop, stub)
  const j2 = r2.find(r => r.nodeId === 'j')!
  assert.ok(j2.output.includes('## W1') && j2.output.includes('## W2'), 'live inputs kept')
  assert.ok(!j2.output.includes('## W3'), 'dead input dropped')
  assert.strictEqual(r2.find(r => r.nodeId === 'n3')!.status, 'skipped', 'n3 skipped')

  // 3. ALL inputs dead → join itself is skipped, syn is skipped
  const dead = base([toJoin('n1'), toJoin('n2'), toJoin('n3'), joinToSyn]) // no seed edges at all
  const r3 = await runChainGraph(dead, agents, [], 'SEED', '/ws', noop, stub)
  assert.strictEqual(r3.find(r => r.nodeId === 'j')!.status, 'skipped', 'join skipped when all inputs dead')
  assert.strictEqual(r3.find(r => r.nodeId === 'ns')!.status, 'skipped', 'syn skipped downstream')

  console.log('✅ join executor tests passed')
}
main().catch(err => { console.error(err); process.exit(1) })
