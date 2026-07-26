import { test } from 'vitest'
import assert from 'node:assert'
import { buildRunStateMap } from '../lib/runHistoryState'
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
  assert.deepStrictEqual(map['n2'].rounds, [
    { round: 0, output: 'round0' },
    { round: 1, output: 'round1' },
  ])

  // n3 assertions
  assert.strictEqual(map['n3'].status, 'skipped')
  assert.strictEqual(map['n3'].output, '')
})
