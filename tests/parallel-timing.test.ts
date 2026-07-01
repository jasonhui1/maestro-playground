import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, prompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'), agent('w3', 'W3: {task}')]
const noop = { onStart() {}, onToken() {}, onDone() {} }
// each call takes ~60ms
const slow = (async (a: AgentDef, sys: string) => {
  await new Promise(r => setTimeout(r, 60))
  return { agentName: a.name, systemPrompt: sys, input: '', output: `out-${a.slug}`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n1', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n2', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n3', toSocket: 'task' },
  ],
}

async function main() {
  const t = Date.now()
  const results = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, slow)
  const elapsed = Date.now() - t
  assert.strictEqual(results.filter(r => r.status === 'success').length, 3, 'all three ran')
  assert.ok(elapsed < 130, `3 independent nodes should run ~60ms concurrently, not ~180ms; got ${elapsed}ms`)
  // ordering invariant still holds
  assert.deepStrictEqual(results.map(r => r.nodeId), ['n1', 'n2', 'n3'], 'topo order preserved')
  console.log(`✅ parallel timing passed (${elapsed}ms)`)
}
main().catch(err => { console.error(err); process.exit(1) })
