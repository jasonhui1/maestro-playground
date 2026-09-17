import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph, RunCallbacks } from '../lib/executor'
import type { runAgent } from '../lib/runner'
import { ChainDef, AgentDef, AgentOutput, HoldRecord } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return {
    slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
    inputs: [], systemPrompt: prompt, filePath: '',
  }
}
function agentOutput(a: AgentDef, sp: string, output = `OUT(${a.slug})`): AgentOutput {
  return {
    agentName: a.name, systemPrompt: sp, input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }
}
const noop: RunCallbacks = { onStart() {}, onToken() {}, onDone() {} }

const decision = `Preamble.

## Candidate 1
Halo as gift.

## Candidate 2
Halo as burden.
Every use costs.`

test('wavefront stop: a hold records nothing, its descendants are never recorded, wave-mates finish', async () => {
  const agents = [agent('dec', 'DEC: {input}'), agent('s', 'S: {input}'), agent('d', 'D: {in}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'dec', kind: 'decider', agent: 'dec' },
      { id: 'h', kind: 'hold', prompt: 'pick one' },
      { id: 's', kind: 'agent', agent: 's' },         // unrelated unit, same wave as h
      { id: 'd', kind: 'agent', agent: 'd' },         // h's descendant
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'dec', toSocket: 'input' },
      { fromNode: 'dec', fromSocket: 'output', toNode: 'h', toSocket: 'in' },
      { fromNode: 'dec', fromSocket: 'output', toNode: 's', toSocket: 'input' },
      { fromNode: 'h', fromSocket: 'output', toNode: 'd', toSocket: 'in' },
    ],
  }
  const starts: string[] = []
  const holds: [string, HoldRecord][] = []
  const callbacks: RunCallbacks = {
    onStart: nodeId => starts.push(nodeId),
    onToken() {},
    onDone() {},
    onHold: (nodeId, hold) => holds.push([nodeId, hold]),
  }
  // 's' outlasts the hold, so its record proves the pause waits for the wave to settle.
  const stub: typeof runAgent = async (a, sp) => {
    if (a.slug === 's') await new Promise(resolve => setTimeout(resolve, 20))
    return agentOutput(a, sp, a.slug === 'dec' ? decision : undefined)
  }

  const results = await runChainGraph(chain, agents, [], 'SEED', '/ws', callbacks, stub)

  assert.deepStrictEqual(results.map(r => r.nodeId).sort(), ['dec', 's'], 'exactly the pre-hold outputs')
  assert.ok(!starts.includes('d'), 'd never starts')
  assert.strictEqual(holds.length, 1)
  const [nodeId, hold] = holds[0]
  assert.strictEqual(nodeId, 'h')
  assert.strictEqual(hold.nodeId, 'h')
  assert.strictEqual(hold.prompt, 'pick one')
  assert.strictEqual(hold.input, decision, 'the text on `in`, verbatim')
  assert.deepStrictEqual(hold.candidates, [
    { heading: 'Candidate 1', body: 'Halo as gift.' },
    { heading: 'Candidate 2', body: 'Halo as burden.\nEvery use costs.' },
  ])
  assert.ok(!Number.isNaN(Date.parse(hold.reachedAt)))
  assert.strictEqual(hold.resolvedAt, undefined)
})

test('a hold with a dead input is skipped, not held', async () => {
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'g', kind: 'gate', condition: 'false' },
      { id: 'h', kind: 'hold' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
      { fromNode: 'g', fromSocket: 'output', toNode: 'h', toSocket: 'in' },
    ],
  }
  let held = false
  const results = await runChainGraph(chain, [], [], 'SEED', '/ws', { ...noop, onHold: () => { held = true } })
  assert.strictEqual(held, false)
  assert.strictEqual(results.find(r => r.nodeId === 'h')?.status, 'skipped')
})

test('resume as replay: a hold already answered does not pause; only post-hold units execute', async () => {
  const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'), agent('g', 'G: {direction} {joined}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'w1', kind: 'agent', agent: 'w1' },
      { id: 'w2', kind: 'agent', agent: 'w2' },
      { id: 'j', kind: 'join' },
      { id: 'hold', kind: 'hold' },
      { id: 'g', kind: 'agent', agent: 'g' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w1', toSocket: 'task' },
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w2', toSocket: 'task' },
      { fromNode: 'w1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
      { fromNode: 'w2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
      { fromNode: 'j', fromSocket: 'output', toNode: 'hold', toSocket: 'in' },
      { fromNode: 'hold', fromSocket: 'output', toNode: 'g', toSocket: 'direction' },
      { fromNode: 'j', fromSocket: 'output', toNode: 'g', toSocket: 'joined' }, // exercises the join's replay
    ],
  }
  const rec = (nodeId: string, output: string): AgentOutput => ({
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  })
  const joinOutput = '## W1\nout-w1\n\n## W2\nout-w2'
  const startOutputs: AgentOutput[] = [
    rec('w1', 'out-w1'),
    rec('w2', 'out-w2'),
    rec('j', joinOutput),
    rec('hold', 'PICK: Candidate 1\nsome direction'),
  ]

  const order: string[] = []
  const stub: typeof runAgent = async (a, sp) => { order.push(a.slug); return agentOutput(a, sp) }
  let held = false

  const results = await runChainGraph(
    chain, agents, [], 'SEED', '/ws', { ...noop, onHold: () => { held = true } }, stub, startOutputs,
  )

  assert.strictEqual(held, false, 'the replayed hold does not pause')
  assert.deepStrictEqual(order, ['g'])
  const g = results.find(r => r.nodeId === 'g')!
  assert.strictEqual(g.status, 'success', "the hold's out-edge is live")
  assert.ok(g.systemPrompt.includes('PICK: Candidate 1'), 'g received the hold answer')
  assert.ok(g.systemPrompt.includes('## W1'), "g's prompt carries the replayed join's labelled section")
  assert.strictEqual(results.find(r => r.nodeId === 'j')!.output, joinOutput)
})
