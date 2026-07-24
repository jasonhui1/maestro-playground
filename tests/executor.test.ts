import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('a', 'Seed: {input}'), agent('b', 'From A: {fromA}')]
const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'na', kind: 'agent', agent: 'a' },
    { id: 'nb', kind: 'agent', agent: 'b' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'na', toSocket: 'input' },
    { fromNode: 'na', fromSocket: 'output', toNode: 'nb', toSocket: 'fromA' },
  ],
}

// Stub runner: echoes the resolved system prompt as its output, records call order.
const seenPrompts: Record<string, string> = {}
const order: string[] = []
const stub = (async (a: AgentDef, systemPrompt: string) => {
  order.push(a.slug)
  seenPrompts[a.slug] = systemPrompt
  return { agentName: a.name, systemPrompt, input: '', output: `OUT(${a.slug}):${systemPrompt}`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

const noop = { onStart() {}, onToken() {}, onDone() {} }

async function main() {
  const results = await runChainGraph(chain, agents, [], 'MY SEED', '/ws', noop, stub)
  assert.deepStrictEqual(order, ['a', 'b'], 'topological order a before b')
  assert.ok(seenPrompts['a'].includes('MY SEED'), 'seed wired into a')
  assert.ok(seenPrompts['b'].includes('OUT(a)'), "a's output wired into b")
  assert.strictEqual(results.length, 2)
  assert.strictEqual(results[0].nodeId, 'na')
  assert.strictEqual(results[1].nodeId, 'nb')

  // branching: replay na, only b runs
  order.length = 0
  const replay: AgentOutput[] = [{ ...results[0] }]
  const results2 = await runChainGraph(chain, agents, [], 'MY SEED', '/ws', noop, stub, replay)
  assert.deepStrictEqual(order, ['b'], 'only b runs when na is replayed')
  assert.strictEqual(results2.length, 2)

}

test('executor', main)