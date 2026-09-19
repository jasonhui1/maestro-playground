import { test } from 'vitest'
import assert from 'node:assert'
import { answerHold, hasAnsweredHold, holdsKeptByFork, openHold, readPick, selectHold } from '../lib/hold'
import type { HoldRecord, RunMeta } from '../lib/types'

const DECIDER = '## Candidate 1\nA\n\n## Candidate 2\nB'

const hold = (nodeId: string, extra: Partial<HoldRecord> = {}): HoldRecord => ({
  nodeId, input: DECIDER, reachedAt: '2026-09-19T00:00:00.000Z',
  candidates: [{ heading: 'Candidate 1', body: 'A' }, { heading: 'Candidate 2', body: 'B' }],
  ...extra,
})
const answered = (nodeId: string) => hold(nodeId, { direction: 'go', resolvedAt: '2026-09-19T01:00:00.000Z' })

const meta = (status: RunMeta['status'], holds: HoldRecord[]): RunMeta => ({
  runId: 'r', chainName: 'c', seedPrompt: '', startedAt: '', status, agentOutputs: [], holds,
})

test('selectHold: a named hold is the last record for that node', () => {
  const first = answered('gate')
  const again = hold('gate')
  assert.strictEqual(selectHold(meta('waiting', [first, again]), 'gate'), again)
})

test('selectHold: naming no hold of the run is a 404 refusal', () => {
  assert.deepStrictEqual(selectHold(meta('waiting', [hold('gate')]), 'nope'),
    { error: 'holdId names no hold of this run', status: 404 })
})

test('selectHold: a waiting run answers its open hold', () => {
  const open = hold('second')
  assert.strictEqual(selectHold(meta('waiting', [answered('first'), open])), open)
})

test('selectHold: several holds with none named is a 400 refusal', () => {
  const refusal = selectHold(meta('complete', [answered('first'), answered('second')]))
  assert.ok('error' in refusal)
  assert.strictEqual(refusal.status, 400)
})

test("selectHold: a finished run's only hold is its last record", () => {
  const last = answered('gate')
  assert.strictEqual(selectHold(meta('complete', [answered('gate'), last])), last)
})

test('selectHold: a run with no holds is a 409 refusal', () => {
  const refusal = selectHold(meta('complete', []))
  assert.ok('error' in refusal)
  assert.strictEqual(refusal.status, 409)
})

test('readPick: a candidate heading matches forgiving case and spacing', () => {
  assert.deepStrictEqual(readPick(hold('gate'), ' candidate  2 ', undefined), { candidate: { heading: 'Candidate 2', body: 'B' } })
})

test('readPick: refusals are Refusal values', () => {
  for (const [chosen, custom] of [['Candidate 1', 'mine'], [undefined, '  '], ['Candidate 9', undefined]]) {
    const pick = readPick(hold('gate'), chosen, custom)
    assert.ok(pick && 'error' in pick, `${chosen}/${custom} refused`)
    assert.strictEqual(pick.status, 400)
  }
  assert.strictEqual(readPick(hold('gate'), undefined, undefined), undefined)
})

test('answerHold: an open hold resumes and its record is replaced in the list', () => {
  const other = answered('first')
  const open = hold('gate')
  const answer = answerHold([other, open], open, 'go', { custom: 'my idea' })
  assert.strictEqual(answer.mode, 'resume')
  assert.strictEqual(answer.holds[0], other)
  assert.strictEqual(answer.holds[1], answer.record)
  assert.strictEqual(answer.record.custom, 'my idea')
  assert.ok(answer.record.resolvedAt)
  assert.strictEqual(answer.output.output, 'PICK: custom\nmy idea\n\ngo')
})

test('answerHold: an answered hold forks and drops its earlier answer', () => {
  const done = hold('gate', { chosen: 'Candidate 1', direction: 'old', resolvedAt: 'x' })
  const answer = answerHold([done], done, 'new')
  assert.strictEqual(answer.mode, 'fork')
  assert.strictEqual(answer.record.chosen, undefined)
  assert.strictEqual(answer.record.direction, 'new')
  assert.strictEqual(answer.output.output, 'new')
})

test('openHold: no candidates on a wired input warns against the producer', () => {
  const { record, warning } = openHold('gate', 'no sections here', { fromNode: 'decider' })
  assert.deepStrictEqual(record.candidates, [])
  assert.deepStrictEqual(warning, { fromNode: 'decider', section: 'Candidate 1', toNode: 'gate', toSocket: 'candidates' })
})

test('openHold: candidates, or no producer, mean no warning', () => {
  assert.strictEqual(openHold('gate', DECIDER, { prompt: 'pick one', fromNode: 'decider' }).warning, undefined)
  assert.strictEqual(openHold('gate', '').warning, undefined)
})

test('hasAnsweredHold: only an answered hold among the nodes counts', () => {
  const holds = [answered('a'), hold('b')]
  assert.strictEqual(hasAnsweredHold(holds, new Set(['a'])), true)
  assert.strictEqual(hasAnsweredHold(holds, new Set(['b'])), false)
  assert.strictEqual(hasAnsweredHold(undefined, new Set(['a'])), false)
})

test('holdsKeptByFork: answered holds above the anchor', () => {
  const above = answered('a')
  assert.deepStrictEqual(holdsKeptByFork([above, answered('b'), hold('c')], new Set(['b'])), [above])
})

test('answerHold: a copied record is still the one replaced', () => {
  const open = hold('gate')
  const answer = answerHold([open], { ...open }, 'go')
  assert.deepStrictEqual(answer.holds, [answer.record])
})
