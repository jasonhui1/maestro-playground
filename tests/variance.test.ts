import { test } from 'vitest'
import assert from 'node:assert'
import { buildVarianceGroup, spreadOf } from '../lib/variance'
import type { AgentOutput, RunMeta } from '../lib/types'

function output(nodeId: string, text: string, costUsd: number | undefined = 0.01): AgentOutput {
  return {
    nodeId,
    agentName: nodeId,
    systemPrompt: '',
    input: '',
    output: text,
    tokensIn: 10,
    tokensOut: 10,
    costUsd,
    latencyMs: 100,
    model: 'model',
    timestamp: '2026-09-22T10:00:00.000Z',
    status: 'success',
  }
}

function run(index: number, outputs: AgentOutput[]): RunMeta {
  return {
    runId: `run-${index + 1}`,
    chainName: 'relay',
    chainSlug: 'relay',
    seedPrompt: 'same seed',
    startedAt: `2026-09-22T10:00:0${index}.000Z`,
    completedAt: `2026-09-22T10:01:0${index}.000Z`,
    status: 'complete',
    agentOutputs: outputs,
    versions: { 'chain/relay': 3, 'agent/writer': 7 },
    variance: { groupId: 'variance-1', index, size: 3 },
    graph: {
      nodes: [
        { id: 'world-builder', kind: 'agent', agent: 'world-builder' },
        { id: 'scene-writer', kind: 'agent', agent: 'scene-writer' },
      ],
      edges: [],
    },
  }
}

test('spreadOf returns mean pairwise compare distance for each node column', () => {
  const spreads = spreadOf([
    ['the same', 'the same', 'the same'],
    ['red', 'blue', 'green'],
    ['same', 'same', 'other'],
  ])

  assert.deepStrictEqual(spreads, [0, 1, 2 / 3])
})

test('a variance group lists node spread, ordinary runs and their summed cost', () => {
  const group = buildVarianceGroup([
    run(0, [output('world-builder', 'shared'), output('scene-writer', 'red')]),
    run(1, [output('world-builder', 'shared'), output('scene-writer', 'blue')]),
    run(2, [output('world-builder', 'shared'), output('scene-writer', 'green')]),
  ])

  assert.strictEqual(group.groupId, 'variance-1')
  assert.strictEqual(group.expectedRunCount, 3)
  assert.deepStrictEqual(group.runs.map(r => r.runId), ['run-1', 'run-2', 'run-3'])
  assert.deepStrictEqual(group.nodes.map(n => ({ nodeId: n.nodeId, spread: n.spread })), [
    { nodeId: 'world-builder', spread: 0 },
    { nodeId: 'scene-writer', spread: 1 },
  ])
  assert.ok(Math.abs((group.costUsd ?? 0) - 0.06) < Number.EPSILON)
})

test('one unpriced output makes the group total unpriced instead of silently partial', () => {
  const unpriced = output('world-builder', 'shared')
  delete unpriced.costUsd
  const group = buildVarianceGroup([
    run(0, [output('world-builder', 'shared')]),
    run(1, [unpriced]),
  ])

  assert.strictEqual(group.costUsd, undefined)
  assert.strictEqual(group.costWarning, 'one or more runs contain unpriced output')
})

test('a node with fewer than two successful outputs has no spread instead of false zero', () => {
  const failed = { ...output('world-builder', ''), status: 'error' as const, error: 'model failed' }
  const group = buildVarianceGroup([
    run(0, [output('world-builder', 'only successful answer')]),
    run(1, [failed]),
  ])

  assert.strictEqual(group.nodes[0].spread, undefined)
})
