import { test } from 'vitest'
import assert from 'node:assert'
import { buildRunStateMap, runOrderOf, stepIndexOf, latestOutputsByNode } from '../lib/runHistoryState'
import type { AgentOutput } from '../lib/types'

test('runHistoryState', () => {
  const outputs: AgentOutput[] = [
    {
      nodeId: 'n1',
      agentName: 'Agent A',
      systemPrompt: 'prompt',
      input: 'in',
      output: 'out1',
      thought: 'thinking',
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.01,
      latencyMs: 100,
      status: 'success',
      model: 'm',
      timestamp: 't',
    },
    {
      nodeId: 'n2',
      agentName: 'Loop Agent',
      systemPrompt: 'prompt',
      input: 'in',
      output: 'round0',
      round: 0,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.01,
      latencyMs: 100,
      status: 'success',
      model: 'm',
      timestamp: 't',
    },
    {
      nodeId: 'n2',
      agentName: 'Loop Agent',
      systemPrompt: 'prompt',
      input: 'in',
      output: 'round1',
      round: 1,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.01,
      latencyMs: 100,
      status: 'success',
      model: 'm',
      timestamp: 't',
    },
    {
      nodeId: 'n3',
      agentName: 'Skipped Node',
      systemPrompt: '',
      input: '',
      output: '',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 'skipped',
      model: 'm',
      timestamp: 't',
    },
  ]

  const map = buildRunStateMap(outputs)

  // n1 assertions
  assert.strictEqual(map['n1'].status, 'success')
  assert.strictEqual(map['n1'].output, 'out1')
  assert.strictEqual(map['n1'].thought, 'thinking')
  assert.strictEqual(map['n1'].agentName, 'Agent A')
  assert.deepStrictEqual(map['n1'].rounds, [])
  // parity with applyRunEvent: the raw payload rides along for metric/prompt/error views (#33)
  assert.strictEqual(map['n1'].result?.output, map['n1'].output)

  // n2 assertions
  assert.strictEqual(map['n2'].status, 'success')
  assert.strictEqual(map['n2'].output, 'round1')
  // per-round metrics, same shape the live fold builds (#64)
  const m = { tokensIn: 10, tokensOut: 10, costUsd: 0.01, latencyMs: 100 }
  assert.deepStrictEqual(map['n2'].rounds, [
    { round: 0, output: 'round0', metrics: m },
    { round: 1, output: 'round1', metrics: m },
  ])

  // n3 assertions
  assert.strictEqual(map['n3'].status, 'skipped')
  assert.strictEqual(map['n3'].output, '')
})

// De-risk 4 (#90): a promote-style rerun leaves two records for the same node, no round
// involved. The run-detail overlay (canvas + rail) must read the last one, not the first.
test('buildRunStateMap collapses a promote-style rerun to its last write', () => {
  const out = (nodeId: string, output: string): AgentOutput => ({
    nodeId, agentName: 'Creative Director', systemPrompt: '', input: 'in', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, status: 'success',
    model: 'm', timestamp: 't',
  })
  const map = buildRunStateMap([
    out('creative-director', 'first pass, stale'),
    out('creative-director', 'second pass, latest'),
  ])
  assert.strictEqual(map['creative-director'].output, 'second pass, latest')
})

test('latestOutputsByNode', () => {
  const out = (nodeId: string | undefined, output: string): AgentOutput => ({
    nodeId, agentName: 'A', systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, status: 'success',
    model: 'm', timestamp: 't',
  })

  // Repeated node id: last write wins, kept at the first-appearance position.
  assert.deepStrictEqual(
    latestOutputsByNode([out('a', 'a1'), out('b', 'b1'), out('a', 'a2')]).map(o => o.output),
    ['a2', 'b1'],
  )

  // No nodeId: predates graph capture, cannot be matched to any other record, kept as-is.
  assert.deepStrictEqual(
    latestOutputsByNode([out(undefined, 'x1'), out(undefined, 'x2')]).map(o => o.output),
    ['x1', 'x2'],
  )

  assert.deepStrictEqual(latestOutputsByNode([]), [])
})

// The sidebar rail and "branch from here" both read the flat agentOutputs list: one
// needs the node order, the other needs the step a given round was written at (#64).
test('runOrderOf / stepIndexOf', () => {
  const out = (nodeId: string, round?: number): AgentOutput => ({
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output: '',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
    status: 'success', model: 'm', timestamp: 't',
    ...(round !== undefined ? { round } : {}),
  })
  const outputs = [out('a'), out('loop', 0), out('loop', 1), out('loop', 2), out('b')]

  // one entry per node, in the order each first appears — a loop's rounds do not repeat it
  assert.deepStrictEqual(runOrderOf(outputs), ['a', 'loop', 'b'])
  assert.deepStrictEqual(runOrderOf([]), [])
  // an output with no nodeId predates graph capture and cannot be placed on the rail
  assert.deepStrictEqual(runOrderOf([{ ...out('a'), nodeId: undefined }]), [])

  // a named round resolves to the step that round was written at
  assert.strictEqual(stepIndexOf(outputs, 'loop', 1), 2)
  assert.strictEqual(stepIndexOf(outputs, 'loop', 0), 1)
  // null round means "the round in view is the latest" — branch from the node's last step
  assert.strictEqual(stepIndexOf(outputs, 'loop', null), 3)
  assert.strictEqual(stepIndexOf(outputs, 'a', null), 0)
  // a node that never ran, or a round it never reached, has no step to branch from
  assert.strictEqual(stepIndexOf(outputs, 'seed', null), -1)
  assert.strictEqual(stepIndexOf(outputs, 'loop', 9), -1)
})
