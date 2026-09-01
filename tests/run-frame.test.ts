import { test } from 'vitest'
import assert from 'node:assert'
import { buildRunFrame } from '../lib/runFrame'
import { emptyNodeState, RunStateMap } from '../lib/runState'
import type { AgentOutput, ChainDef } from '../lib/types'

function chain(over: Partial<ChainDef> = {}): ChainDef {
  return {
    slug: 'relay', name: 'telephone-relay', description: 'three restatements',
    nodes: [], edges: [], filePath: '', isFavorite: false, ...over,
  }
}

function output(costUsd: number): AgentOutput {
  return {
    agentName: 'Relay', systemPrompt: '', input: '', output: '',
    tokensIn: 0, tokensOut: 0, costUsd, latencyMs: 0, model: 'm',
    timestamp: '', status: 'success',
  }
}

function states(entries: Record<string, Partial<ReturnType<typeof emptyNodeState>>>): RunStateMap {
  return Object.fromEntries(Object.entries(entries).map(([id, s]) => [id, { ...emptyNodeState(), ...s }]))
}

const paste = { kind: 'paste' } as const

test('the frame leads with the moment, not the mechanism', () => {
  const frame = buildRunFrame({
    chain: chain({ moment: 'finalizing a doc, not sure it holds up' }),
    seed: paste, states: {}, now: 0,
  })
  assert.strictEqual(frame.chainName, 'telephone-relay')
  assert.strictEqual(frame.moment, 'finalizing a doc, not sure it holds up')
})

test('a chain with no moment falls back to its description', () => {
  const frame = buildRunFrame({ chain: chain(), seed: paste, states: {}, now: 0 })
  assert.strictEqual(frame.moment, 'three restatements')
})

test('the seed source names the picked file, or says the text was pasted', () => {
  assert.strictEqual(
    buildRunFrame({ chain: chain(), seed: paste, states: {}, now: 0 }).seedSource,
    'pasted text',
  )
  assert.strictEqual(
    buildRunFrame({ chain: chain(), seed: { kind: 'file', name: 'vision.md' }, states: {}, now: 0 }).seedSource,
    'vision.md',
  )
})

// A run reopened from history (#72) never recorded whether its seed was pasted or a
// file, so the frame names neither rather than guessing.
test('a run reopened from history names its seed as the log recorded it', () => {
  const frame = buildRunFrame({ chain: chain(), seed: { kind: 'log' }, states: {}, now: 0 })
  assert.strictEqual(frame.seedSource, 'the run\'s recorded seed')
})

// Cost fills in as hops land, so the frame is readable mid-run rather than at the end.
test('cost sums every node settled so far', () => {
  const frame = buildRunFrame({
    chain: chain(), seed: paste, now: 0,
    states: states({
      first: { status: 'success', result: output(0.01) },
      second: { status: 'running' },
    }),
  })
  assert.strictEqual(Number(frame.costUsd.toFixed(6)), 0.01)
})

// A loop-body node reports once per round; the run paid for all of them.
test('cost counts every round a looping node ran, not just its last', () => {
  const frame = buildRunFrame({
    chain: chain(), seed: paste, now: 0,
    states: states({
      body: {
        status: 'success',
        result: output(0.02),
        rounds: [
          { round: 1, output: '', metrics: { tokensIn: 0, tokensOut: 0, costUsd: 0.03, latencyMs: 0 } },
          { round: 2, output: '', metrics: { tokensIn: 0, tokensOut: 0, costUsd: 0.02, latencyMs: 0 } },
        ],
      },
    }),
  })
  assert.strictEqual(Number(frame.costUsd.toFixed(6)), 0.05)
})

test('elapsed runs against the clock while the run is live, and freezes when it ends', () => {
  const live = buildRunFrame({ chain: chain(), seed: paste, states: {}, startedAt: 1000, now: 4500 })
  assert.strictEqual(live.elapsedMs, 3500)

  const done = buildRunFrame({ chain: chain(), seed: paste, states: {}, startedAt: 1000, endedAt: 3000, now: 9999 })
  assert.strictEqual(done.elapsedMs, 2000)

  const notStarted = buildRunFrame({ chain: chain(), seed: paste, states: {}, now: 9999 })
  assert.strictEqual(notStarted.elapsedMs, 0)
})
