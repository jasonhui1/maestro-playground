import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { AgentDef, AgentOutput, ChainDef } from '../lib/types'

const agent = (slug: string, systemPrompt: string): AgentDef => ({
  slug, name: slug, model: 'gpt-4o', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [], inputs: [], systemPrompt, filePath: '',
})
// the fake runner echoes the *resolved* system prompt, so injected input values show up in the output
const fakeRun = async (a: AgentDef, systemPrompt: string): Promise<AgentOutput> => ({
  agentName: a.name, systemPrompt, input: '', output: systemPrompt,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: new Date().toISOString(), status: 'success',
})
const noop = { onStart() {}, onToken() {}, onDone() {} }

// inner: two seeds feed two agents; the chain exposes two named outputs
const inner: ChainDef = {
  slug: 'inner', name: 'Inner', description: '', filePath: '',
  nodes: [
    { id: 'seedA', kind: 'seed' }, { id: 'seedB', kind: 'seed' },
    { id: 'w', kind: 'agent', agent: 'w' }, { id: 'v', kind: 'agent', agent: 'v' },
  ],
  edges: [
    { fromNode: 'seedA', fromSocket: 'output', toNode: 'w', toSocket: 'x' },
    { fromNode: 'seedB', fromSocket: 'output', toNode: 'v', toSocket: 'y' },
  ],
  inputs: [{ name: 'x', node: 'seedA' }, { name: 'y', node: 'seedB' }],
  outputs: [{ name: 'rw', node: 'w' }, { name: 'rv', node: 'v' }],
}
const parent: ChainDef = {
  slug: 'parent', name: 'Parent', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'sub', kind: 'subchain', subchain: 'inner' }],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'x' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'y' },
  ],
}
const agents = [agent('w', 'X={x}'), agent('v', 'Y={y}')]

async function main() {
  const results = await runChainGraph(parent, agents, [], 'PARENT', '/tmp', noop, fakeRun, [], [inner])
  // each declared output landed in per-socket storage; injection filled the inner slots
  const rw = results.find(r => r.nodeId === 'sub::rw')
  const rv = results.find(r => r.nodeId === 'sub::rv')
  assert.ok(rw && rw.output.includes('PARENT'), 'output rw carries the injected input value')
  assert.ok(rv && rv.output.includes('PARENT'), 'output rv carries the injected input value')
  assert.ok(!rw!.output.includes('not wired'), 'inner slot x was injected, not left unwired')

  // depth guard
  await assert.rejects(() => runChainGraph(parent, agents, [], 'PARENT', '/tmp', noop, fakeRun, [], [inner], 99), /too deep/i)

  // subchain declares two inputs (topic, tone); only topic is wired by the host — the
  // subchain still runs (unwired optional inputs never block).
  {
    const partialInner: ChainDef = {
      slug: 'partial', name: 'Partial', description: '', filePath: '',
      nodes: [{ id: 'seedA', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'w' }],
      edges: [{ fromNode: 'seedA', fromSocket: 'output', toNode: 'w', toSocket: 'x' }],
      inputs: [{ name: 'topic', node: 'seedA' }, { name: 'tone', node: 'seedA' }],
      outputs: [{ name: 'rw', node: 'w' }],
    }
    const partialParent: ChainDef = {
      slug: 'parent2', name: 'Parent2', description: '', filePath: '',
      nodes: [{ id: 'seed', kind: 'seed' }, { id: 'sub', kind: 'subchain', subchain: 'partial' }],
      edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'topic' }],
    }
    const res = await runChainGraph(partialParent, agents, [], 'PARENT', '/tmp', noop, fakeRun, [], [partialInner])
    const status = res.find(r => r.nodeId === 'sub')
    assert.ok(status && status.status !== 'skipped', 'subchain with only one of two declared inputs wired still runs')
  }
  // an agent node's declared input is non-optional: leaving it unwired still skips the node.
  {
    const agents2 = [agent('needsInput', 'X={x}')]
    const chain: ChainDef = {
      slug: 'c3', name: 'c3', description: '', filePath: '',
      nodes: [{ id: 'n', kind: 'agent', agent: 'needsInput' }],
      edges: [],
    }
    const res = await runChainGraph(chain, agents2, [], 'SEED', '/tmp', noop, fakeRun)
    assert.strictEqual(res.find(r => r.nodeId === 'n')!.status, 'skipped', 'agent node with an unwired slot still skips')
  }

  console.log('✅ executor-subchain tests passed')
}
main().catch(e => { console.error(e); process.exit(1) })
