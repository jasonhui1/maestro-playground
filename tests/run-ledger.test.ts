import { describe, test, expect } from 'vitest'
import { summarizeRun, summarizeCost } from '@/lib/runLedger'
import { varianceGroupStatus } from '@/lib/runStatus'
import { unpricedWarning } from '@/lib/pricing'
import { buildVarianceGroup } from '@/lib/variance'
import { buildRunFrame } from '@/lib/runFrame'
import { emptyNodeState } from '@/lib/runState'
import type { AgentOutput, ChainDef, RunMeta } from '@/lib/types'

function output(model: string, costUsd: number | undefined, extra: Partial<AgentOutput> = {}): AgentOutput {
  return {
    nodeId: 'n', agentName: 'n', systemPrompt: '', input: '', output: 'x',
    tokensIn: 10, tokensOut: 5, costUsd, latencyMs: 100, model,
    timestamp: '', status: 'success', ...extra,
  }
}

function run(id: string, outputs: AgentOutput[], extra: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: id, chainName: 'c', seedPrompt: 's', startedAt: '2026-09-23T10:00:00Z',
    status: 'complete', agentOutputs: outputs, ...extra,
  }
}

describe('summarizeCost: sum priced, report unpriced', () => {
  test('all priced', () => {
    const s = summarizeCost([{ costUsd: 0.0124, model: 'a' }, { costUsd: 0.026, model: 'b' }])
    expect(s.costUsd?.toFixed(4)).toBe('0.0384')
    expect(s.pricedCount).toBe(2)
    expect(s.unpricedCount).toBe(0)
    expect(s.costWarning).toBeUndefined()
  })

  test('mixed keeps the partial sum and names each unpriced model once', () => {
    const s = summarizeCost([
      { costUsd: 0.01, model: 'openai/gpt-4o' },
      { model: 'unpriced-a' },
      { model: 'unpriced-b' },
      { model: ' unpriced-a ' },
    ])
    expect(s.costUsd).toBe(0.01)
    expect(s.unpricedCount).toBe(3)
    expect(s.unpricedModels).toEqual(['unpriced-a', 'unpriced-b'])
    expect(s.costWarning).toBe('no price for unpriced-a, unpriced-b')
  })

  test('nothing priced has no total; a free model at 0 counts as priced', () => {
    expect(summarizeCost([{ model: 'x' }]).costUsd).toBeUndefined()
    expect(summarizeCost([]).costUsd).toBeUndefined()
    const free = summarizeCost([{ costUsd: 0, model: 'gemma-4-31b-it' }])
    expect(free.costUsd).toBe(0)
    expect(free.unpricedCount).toBe(0)
  })

  test('an unnamed unpriced entry still warns, with the unnamed-model wording', () => {
    const s = summarizeCost([{ costUsd: 0.01 }, {}])
    expect(s.unpricedCount).toBe(1)
    expect(s.unpricedModels).toEqual([])
    expect(s.costWarning).toBe('no price for an unnamed model')
    expect(unpricedWarning([])).toBe('no price for an unnamed model')
  })
})

describe('summarizeRun(run)', () => {
  test('reads status, steps, tokens, cost and duration from one run', () => {
    const l = summarizeRun(run('r1', [output('a', 0.02), output('mystery', undefined, { latencyMs: 400 })], {
      completedAt: '2026-09-23T10:00:15.500Z',
    }))
    expect(l).toMatchObject({
      status: 'complete', steps: 2, tokens: 30, costUsd: 0.02, unpricedCount: 1,
      unpricedModels: ['mystery'], durationMs: 15500,
    })
  })

  test('duration falls back to summed latency without completedAt', () => {
    expect(summarizeRun(run('r', [output('a', 1), output('a', 1)])).durationMs).toBe(200)
  })
})

describe('summarizeRun(variance group)', () => {
  const groupOf = (runs: RunMeta[]) => buildVarianceGroup(runs.map((r, i) => ({
    ...r, variance: { groupId: 'g', index: i, size: runs.length },
  })))

  test('sums steps, tokens and priced cost across runs; duration is the slowest run', () => {
    const group = groupOf([
      run('r1', [output('a', 0.01)], { completedAt: '2026-09-23T10:00:02Z' }),
      run('r2', [output('a', 0.02), output('mystery', undefined)], { completedAt: '2026-09-23T10:00:05Z' }),
    ])
    const l = summarizeRun(group)
    expect(l).toMatchObject({ steps: 3, tokens: 45, unpricedCount: 1, unpricedModels: ['mystery'], durationMs: 5000 })
    expect(l.costUsd).toBeCloseTo(0.03)
    expect(l.costWarning).toBe('no price for mystery')
  })

  test('the group projection carries the ledger result: a partial total always comes with a warning (#133)', () => {
    const group = groupOf([run('r1', [output('a', 0.01)]), run('r2', [output('mystery', undefined)])])
    expect(group.costUsd).toBe(0.01)
    expect(group.costWarning).toBe('no price for mystery')
    const allPriced = groupOf([run('r1', [output('a', 0.01)])])
    expect(allPriced.costUsd).toBe(0.01)
    expect(allPriced.costWarning).toBeUndefined()
    expect(groupOf([run('r1', [])]).costUsd).toBeUndefined()
  })

  test('aggregate status: error beats waiting beats running; complete needs every run', () => {
    const make = (statuses: RunMeta['status'][]) => groupOf(statuses.map((s, i) => run(`r${i}`, [], { status: s })))
    expect(varianceGroupStatus(make(['complete', 'complete']))).toBe('complete')
    expect(varianceGroupStatus(make(['complete', 'error']))).toBe('error')
    expect(varianceGroupStatus(make(['complete', 'waiting']))).toBe('waiting')
    expect(summarizeRun(make(['complete', 'running'])).status).toBe('running')
  })
})

describe('run frame agrees with the ledger', () => {
  test('the same outputs give the same total, count and warning', () => {
    const chain = { slug: 's', name: 'S', description: '', nodes: [], edges: [], filePath: '', isFavorite: false } as ChainDef
    const a = output('openai/gpt-4o', 0.02)
    const b = output('mystery', undefined)
    const frame = buildRunFrame({
      chain, seed: { kind: 'paste' }, now: 0,
      states: {
        a: { ...emptyNodeState(), status: 'success', result: a },
        b: { ...emptyNodeState(), status: 'success', result: b },
      },
    })
    const l = summarizeRun(run('r', [a, b]))
    expect(frame.costUsd).toBe(l.costUsd)
    expect(frame.unpricedCount).toBe(l.unpricedCount)
    expect(frame.costWarning).toBe(l.costWarning)
  })
})
