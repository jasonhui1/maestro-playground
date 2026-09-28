import { test } from 'vitest'
import assert from 'node:assert'
import { planReroll, readRerollRequest, rerollPrompt } from '../lib/reroll'
import { parseChainContent } from '../lib/parseChain'
import type { AgentOutput, HoldRecord, RunMeta } from '../lib/types'

const record = (nodeId: string, extra: Partial<AgentOutput> = {}): AgentOutput => ({
  nodeId, agentName: nodeId, systemPrompt: `prompt of ${nodeId}`, input: 'Follow your instructions.', output: '## Candidate 1\nA',
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...extra,
})
const hold: HoldRecord = { nodeId: 'hold', input: '## Candidate 1\nA', candidates: [], reachedAt: 't0' }

function run(edges: string, outputs: AgentOutput[] = [record('dec')], extraNodes = ''): RunMeta {
  const chain = parseChainContent(`---
name: c
nodes:
  - id: seed
    kind: seed
  - id: dec
    kind: decider
    agent: dec
  - id: hold
    kind: hold
${extraNodes}edges:
  - from: seed
    to: dec.input
${edges}---
`, 'c')
  return {
    runId: 'r', chainName: 'c', seedPrompt: '', startedAt: '', status: 'waiting', agentOutputs: outputs, holds: [hold],
    graph: { nodes: chain.nodes, edges: chain.edges },
  }
}

const DIRECT = '  - from: dec\n    to: hold.in\n'

test('planReroll: a decider wired straight into the hold reruns from its original record', () => {
  const original = record('dec')
  const plan = planReroll(run(DIRECT, [original, record('dec', { systemPrompt: 'augmented', reroll: { holdId: 'hold' } })]), hold)
  assert.ok(!('error' in plan))
  assert.strictEqual(plan.producer.id, 'dec')
  assert.strictEqual(plan.baseline, original)
})

test('planReroll: a producer that also feeds another node is refused', () => {
  const plan = planReroll(run(`${DIRECT}  - from: dec\n    to: other.input\n`, undefined,
    '  - id: other\n    kind: agent\n    agent: other\n'), hold)
  assert.ok('error' in plan)
  assert.strictEqual(plan.status, 422)
  assert.match(plan.error, /also feeds other/)
})

test('planReroll: input transformed through an intermediate node is refused', () => {
  const plan = planReroll(run('  - from: dec\n    to: g.in\n  - from: g\n    to: hold.in\n', undefined,
    '  - id: g\n    kind: gate\n    condition: "true"\n'), hold)
  assert.ok('error' in plan)
  assert.strictEqual(plan.status, 422)
})

test('planReroll: no successful original record is refused', () => {
  const plan = planReroll(run(DIRECT, [record('dec', { status: 'error' })]), hold)
  assert.ok('error' in plan)
  assert.strictEqual(plan.status, 422)
})

test('rerollPrompt: feedback is added once to the original prompt; none leaves it as it was', () => {
  assert.strictEqual(rerollPrompt('base', undefined), 'base')
  assert.strictEqual(rerollPrompt('base', ''), 'base')
  const prompt = rerollPrompt('base', 'darker')
  assert.ok(prompt.startsWith('base\n'))
  assert.strictEqual(prompt.split('darker').length, 2)
})

test('readRerollRequest: feedback and revision are optional and typed', () => {
  assert.deepStrictEqual(readRerollRequest('hold', {}), { holdId: 'hold' })
  assert.deepStrictEqual(readRerollRequest('hold', { feedback: '', revision: 2 }), { holdId: 'hold', feedback: '', revision: 2 })
  assert.strictEqual((readRerollRequest('hold', { revision: 0 }) as { status: number }).status, 400)
  assert.strictEqual((readRerollRequest('hold', { feedback: 1 }) as { status: number }).status, 400)
})

test('readRerollRequest: fork is a boolean and like a heading that cannot stay in place (#147)', () => {
  assert.deepStrictEqual(readRerollRequest('hold', { fork: true, like: 'Candidate 1' }), { holdId: 'hold', fork: true, like: 'Candidate 1' })
  assert.deepStrictEqual(readRerollRequest('hold', { fork: null, like: null }), { holdId: 'hold' })
  assert.strictEqual((readRerollRequest('hold', { fork: 'yes' }) as { status: number }).status, 400)
  assert.strictEqual((readRerollRequest('hold', { like: ' ' }) as { status: number }).status, 400)
  assert.strictEqual((readRerollRequest('hold', { like: 'Candidate 1', fork: false }) as { status: number }).status, 400)
})

test('rerollPrompt: a like candidate is added once, before any feedback (#147)', () => {
  const like = { heading: 'Candidate 2', body: 'the ferry' }
  const prompt = rerollPrompt('base', 'darker', like)
  assert.ok(prompt.startsWith('base\n'))
  assert.strictEqual(prompt.split('the ferry').length, 2)
  assert.ok(prompt.indexOf('the ferry') < prompt.indexOf('darker'))
  assert.ok(rerollPrompt('base', undefined, like).includes('Candidate 2:\nthe ferry'))
})
