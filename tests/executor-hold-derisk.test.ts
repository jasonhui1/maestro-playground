import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph, RunCallbacks } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

// De-risk #89: the `hold` node kind does not exist yet (docs/specs/2026-09-17-
// hitl-engine-hold-node-and-proposer-chat.md). These tests drive the executor
// with a stand-in stop signal (`RunCallbacks.onHold`) in place of a real hold
// node, to prove the wavefront-break and resume-as-replay mechanics before any
// hold-kind plumbing is built.

function agent(slug: string, prompt: string): AgentDef {
  return {
    slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
    inputs: [], systemPrompt: prompt, filePath: '',
  }
}
const noop: RunCallbacks = { onStart() {}, onToken() {}, onDone() {} }
const stub = (async (a: AgentDef, sp: string) => ({
  agentName: a.name, systemPrompt: sp, input: '', output: `OUT(${a.slug})`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})) as never

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
  const results = await runChainGraph(
    chain, agents, [], 'SEED', '/ws',
    { ...noop, onHold: nodeId => nodeId === 'h' },
    stub,
  )
  assert.strictEqual(results.length, 1, 'results hold exactly the pre-hold outputs')
  assert.strictEqual(results[0].nodeId, 's', 'the wave-mate finished')
  assert.strictEqual(results[0].status, 'success')
  assert.strictEqual(results.find(r => r.nodeId === 'h'), undefined, 'the held node itself records nothing')
  assert.strictEqual(results.find(r => r.nodeId === 'd'), undefined, "the held node's descendant is never recorded (no skipped entry)")
})

test('resume as replay: only post-hold units execute; a replayed join keeps its labelled sections', async () => {
  const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'), agent('g', 'G: {direction}')]
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
  const orderingStub = (async (a: AgentDef, sp: string) => {
    order.push(a.slug)
    return { agentName: a.name, systemPrompt: sp, input: '', output: `OUT(${a.slug})`,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
  }) as never

  const results = await runChainGraph(
    chain, agents, [], 'SEED', '/ws', noop, orderingStub, startOutputs,
  )

  assert.deepStrictEqual(order, ['g'], 'only the post-hold unit actually executed')
  const g = results.find(r => r.nodeId === 'g')!
  assert.strictEqual(g.status, 'success', "the hold's out-edge is live, so g ran instead of being skipped")
  assert.ok(g.systemPrompt.includes('PICK: Candidate 1'), 'g received the replayed hold answer')
  const j = results.find(r => r.nodeId === 'j')!
  assert.strictEqual(j.output, joinOutput, 'the replayed join keeps its labelled sections verbatim, not recomputed')
})
