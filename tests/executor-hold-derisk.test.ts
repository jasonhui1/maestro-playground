import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph, RunCallbacks } from '../lib/executor'
import type { runAgent } from '../lib/runner'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

// De-risk #89: the `hold` node kind doesn't exist yet; drives the executor via
// the `shouldHold` stand-in instead.

function agent(slug: string, prompt: string): AgentDef {
  return {
    slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
    inputs: [], systemPrompt: prompt, filePath: '',
  }
}
function agentOutput(a: AgentDef, sp: string): AgentOutput {
  return {
    agentName: a.name, systemPrompt: sp, input: '', output: `OUT(${a.slug})`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }
}
const noop: RunCallbacks = { onStart() {}, onToken() {}, onDone() {} }

test('wavefront stop: a held node records nothing, its descendants are never recorded, wave-mates finish', async () => {
  const agents = [agent('s', 'S: {input}'), agent('d', 'D: {in}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'h', kind: 'gate', condition: '' },      // stand-in for the hold node
      { id: 's', kind: 'agent', agent: 's' },         // unrelated ready unit, same wave as h
      { id: 'd', kind: 'agent', agent: 'd' },         // h's descendant
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'h', toSocket: 'in' },
      { fromNode: 'seed', fromSocket: 'output', toNode: 's', toSocket: 'input' },
      { fromNode: 'h', fromSocket: 'output', toNode: 'd', toSocket: 'in' },
    ],
  }
  const starts: string[] = []
  const dones: string[] = []
  const callbacks: RunCallbacks = {
    onStart: nodeId => starts.push(nodeId),
    onToken() {},
    onDone: nodeId => dones.push(nodeId),
    shouldHold: nodeId => nodeId === 'h',
  }
  // 's' outlasts the hold decision, so a finish recorded for it proves the
  // break happens only after the wave settles, not mid-wave.
  const delayedStub: typeof runAgent = async (a, sp) => {
    if (a.slug === 's') await new Promise(resolve => setTimeout(resolve, 20))
    return agentOutput(a, sp)
  }

  const results = await runChainGraph(chain, agents, [], 'SEED', '/ws', callbacks, delayedStub)

  assert.strictEqual(results.length, 1, 'results hold exactly the pre-hold outputs')
  assert.strictEqual(results[0].nodeId, 's', 'the wave-mate finished')
  assert.strictEqual(results[0].status, 'success')
  assert.strictEqual(results.find(r => r.nodeId === 'h'), undefined, 'the held node itself records nothing')
  assert.strictEqual(results.find(r => r.nodeId === 'd'), undefined, "the held node's descendant is never recorded (no skipped entry)")
  assert.ok(!starts.includes('d') && !dones.includes('d'), 'd never starts or completes')
})

test('resume as replay: only post-hold units execute; a replayed join keeps its labelled sections', async () => {
  const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'), agent('g', 'G: {direction} {joined}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'w1', kind: 'agent', agent: 'w1' },
      { id: 'w2', kind: 'agent', agent: 'w2' },
      { id: 'j', kind: 'join' },
      { id: 'hold', kind: 'gate', condition: '' },    // stand-in: replayed as the hold's answer
      { id: 'g', kind: 'agent', agent: 'g' },          // post-hold unit
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w1', toSocket: 'task' },
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w2', toSocket: 'task' },
      { fromNode: 'w1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
      { fromNode: 'w2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
      { fromNode: 'j', fromSocket: 'output', toNode: 'hold', toSocket: 'in' },
      { fromNode: 'hold', fromSocket: 'output', toNode: 'g', toSocket: 'direction' },
      { fromNode: 'j', fromSocket: 'output', toNode: 'g', toSocket: 'joined' }, // j also consumed directly, so its replay is exercised
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
    rec('hold', 'PICK: Candidate 1\nsome direction'),  // stands in for the resumed hold answer
  ]

  const order: string[] = []
  const orderingStub: typeof runAgent = async (a, sp) => {
    order.push(a.slug)
    return agentOutput(a, sp)
  }

  const results = await runChainGraph(
    chain, agents, [], 'SEED', '/ws',
    { ...noop, shouldHold: nodeId => nodeId === 'hold' }, // would hold if reached; replay must bypass it
    orderingStub, startOutputs,
  )

  assert.deepStrictEqual(order, ['g'], 'the resumed hold takes the replay path (no pause), so only g executed')
  const g = results.find(r => r.nodeId === 'g')!
  assert.strictEqual(g.status, 'success', "the hold's out-edge is live, so g ran instead of being skipped")
  assert.ok(g.systemPrompt.includes('PICK: Candidate 1'), 'g received the replayed hold answer')
  assert.ok(g.systemPrompt.includes('## W1'), "g's prompt carries the replayed join's labelled section")
  const j = results.find(r => r.nodeId === 'j')!
  assert.strictEqual(j.output, joinOutput, 'the replayed join keeps its labelled sections verbatim, not recomputed')
})
