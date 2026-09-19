import { test } from 'vitest'
import assert from 'node:assert'
import { calcCost, isModelPriced, priceWarningFor } from '../lib/pricing'
import { buildRunFrame } from '../lib/runFrame'
import { emptyNodeState, RunStateMap } from '../lib/runState'
import type { AgentOutput, ChainDef } from '../lib/types'

function chain(): ChainDef {
  return {
    slug: 'test-chain', name: 'Test Chain', description: 'test chain',
    nodes: [], edges: [], filePath: '', isFavorite: false,
  }
}

function agentOutput(model: string, costUsd?: number): AgentOutput {
  return {
    agentName: 'Agent', systemPrompt: '', input: '', output: 'done',
    tokensIn: 100, tokensOut: 100, costUsd, latencyMs: 50, model,
    timestamp: '', status: 'success',
  }
}

function states(entries: Record<string, Partial<ReturnType<typeof emptyNodeState>>>): RunStateMap {
  return Object.fromEntries(Object.entries(entries).map(([id, s]) => [id, { ...emptyNodeState(), ...s }]))
}

test('calcCost computes accurate price for known models with and without prefix', () => {
  const sonnetWithPrefix = calcCost('anthropic/claude-sonnet-4.5', 1000, 2000)
  assert.strictEqual(sonnetWithPrefix, 0.000003 * 1000 + 0.000015 * 2000)

  const sonnetWithoutPrefix = calcCost('claude-sonnet-4.5', 1000, 2000)
  assert.strictEqual(sonnetWithoutPrefix, 0.000003 * 1000 + 0.000015 * 2000)

  const sonnet35 = calcCost('anthropic/claude-3.5-sonnet', 1000, 2000)
  assert.strictEqual(sonnet35, 0.000003 * 1000 + 0.000015 * 2000)

  const gpt4oWithPrefix = calcCost('openai/gpt-4o', 1000, 2000)
  assert.strictEqual(gpt4oWithPrefix, 0.000005 * 1000 + 0.000015 * 2000)

  const gpt4oWithoutPrefix = calcCost('gpt-4o', 1000, 2000)
  assert.strictEqual(gpt4oWithoutPrefix, 0.000005 * 1000 + 0.000015 * 2000)
})

test('calcCost returns 0 for known free model gemma-4-31b-it with or without prefix', () => {
  assert.strictEqual(calcCost('gemma-4-31b-it', 5000, 5000), 0)
  assert.strictEqual(calcCost('google/gemma-4-31b-it', 5000, 5000), 0)
  assert.strictEqual(isModelPriced('gemma-4-31b-it'), true)
  assert.strictEqual(isModelPriced('google/gemma-4-31b-it'), true)
  assert.strictEqual(priceWarningFor('gemma-4-31b-it'), undefined)
  assert.strictEqual(priceWarningFor('google/gemma-4-31b-it'), undefined)
})

test('calcCost returns undefined for unknown models and provides price warning', () => {
  assert.strictEqual(calcCost('mistral/mistral-large', 1000, 1000), undefined)
  assert.strictEqual(calcCost('unknown-model', 1000, 1000), undefined)
  assert.strictEqual(isModelPriced('unknown-model'), false)
  assert.strictEqual(priceWarningFor('unknown-model'), 'no price for unknown-model')
})

test('run frame reports costUsd undefined and costWarning naming the unpriced model', () => {
  const frame = buildRunFrame({
    chain: chain(),
    seed: { kind: 'paste' },
    now: 0,
    states: states({
      node1: {
        status: 'success',
        result: agentOutput('unpriced-model-xyz', undefined),
      },
    }),
  })

  assert.strictEqual(frame.costUsd, undefined)
  assert.strictEqual(frame.costWarning, 'no price for unpriced-model-xyz')
})

test('run frame lists all unique unpriced models in costWarning', () => {
  const frame = buildRunFrame({
    chain: chain(),
    seed: { kind: 'paste' },
    now: 0,
    states: states({
      node1: {
        status: 'success',
        result: agentOutput('unpriced-a', undefined),
      },
      node2: {
        status: 'success',
        result: agentOutput('unpriced-b', undefined),
      },
      node3: {
        status: 'success',
        result: agentOutput('unpriced-a', undefined),
      },
    }),
  })

  assert.strictEqual(frame.costUsd, undefined)
  assert.strictEqual(frame.costWarning, 'no price for unpriced-a, unpriced-b')
})

test('run frame reports costUsd and no warning when models are priced', () => {
  const frame = buildRunFrame({
    chain: chain(),
    seed: { kind: 'paste' },
    now: 0,
    states: states({
      node1: {
        status: 'success',
        result: agentOutput('gemma-4-31b-it', 0),
      },
      node2: {
        status: 'success',
        result: agentOutput('anthropic/claude-sonnet-4.5', 0.015),
      },
    }),
  })

  assert.strictEqual(frame.costUsd, 0.015)
  assert.strictEqual(frame.costWarning, undefined)
})
