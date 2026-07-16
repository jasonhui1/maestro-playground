// tests/parallel-order.test.ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, prompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'),
                agent('w3', 'W3: {task}'), agent('syn', 'SYN: {panel}')]
const noop = { onStart() {}, onToken() {}, onDone() {} }
const stub = (async (a: AgentDef, sys: string) => ({
  agentName: a.name, systemPrompt: sys, input: '', output: `out-${a.slug}`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
} as AgentOutput)) as never

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
    { id: 'j', kind: 'join' },
    { id: 'ns', kind: 'agent', agent: 'syn' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n1', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n2', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n3', toSocket: 'task' },
    { fromNode: 'n1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'j', fromSocket: 'output', toNode: 'ns', toSocket: 'panel' },
  ],
}

async function main() {
  const results = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
  assert.deepStrictEqual(results.map(r => r.nodeId), ['n1', 'n2', 'n3', 'j', 'ns'],
    'results stay in topo order')
  const again = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
  assert.deepStrictEqual(again.map(r => r.nodeId), results.map(r => r.nodeId), 'order is stable')
  console.log('✅ parallel order pin passed')
}
main().catch(err => { console.error(err); process.exit(1) })
