import { test } from 'vitest'
import assert from 'node:assert'
import {
  answerHold, checkRevision, hasAnsweredHold, holdsKeptByFork, mergeHolds, openHold, readAnswerRequest, readFeedback, readPick,
  rerollHold, selectHold, selectOpenHold, withFeedback,
} from '../lib/hold'
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

test('readAnswerRequest: candidate selection without direction succeeds for pure selection hold', () => {
  const reqChosen = readAnswerRequest({ chosen: 'Candidate 1' })
  assert.ok(!('error' in reqChosen))
  assert.strictEqual(reqChosen.chosen, 'Candidate 1')
  assert.strictEqual(reqChosen.direction, '')

  const reqCustom = readAnswerRequest({ custom: 'My custom idea' })
  assert.ok(!('error' in reqCustom))
  assert.strictEqual(reqCustom.custom, 'My custom idea')
  assert.strictEqual(reqCustom.direction, '')
})

test('readAnswerRequest: refusal when both direction and candidate pick are absent', () => {
  const refusal = readAnswerRequest({})
  assert.ok('error' in refusal)
  assert.strictEqual(refusal.status, 400)
  assert.strictEqual(refusal.error, 'direction or candidate selection is required')
})

test('answerHold: pure candidate selection with empty direction produces clean output without trailing newlines', () => {
  const open = hold('gate')
  const pick = readPick(open, 'Candidate 1') as { candidate: { heading: string; body: string } }
  const answer = answerHold([open], open, '', pick)
  assert.strictEqual(answer.output.output, 'PICK: Candidate 1\nA')
})


test('openHold: a new record is revision 1 with no feedback', () => {
  const { record } = openHold('gate', DECIDER)
  assert.strictEqual(record.revision, 1)
  assert.strictEqual(record.feedback, undefined)
})

test('mergeHolds: refreshing the open hold keeps its feedback and counts a new candidate set (#134)', () => {
  const open = hold('gate', { feedback: 'less tragic', revision: 2, rerolledAt: 't1' })
  const [refreshed] = mergeHolds([open], [openHold('gate', DECIDER).record])
  assert.strictEqual(refreshed.feedback, 'less tragic')
  assert.strictEqual(refreshed.revision, 3)
  assert.strictEqual(refreshed.rerolledAt, 't1')
})

test('mergeHolds: a hold reached again after its answer starts without the old feedback', () => {
  const done = hold('gate', { feedback: 'less tragic', direction: 'go', resolvedAt: 'x' })
  const merged = mergeHolds([done], [openHold('gate', DECIDER).record])
  assert.strictEqual(merged.length, 2)
  assert.strictEqual(merged[0].feedback, 'less tragic')
  assert.strictEqual(merged[1].feedback, undefined)
  assert.strictEqual(merged[1].revision, 1)
})

test('withFeedback: replaces the saved feedback on that hold only; empty clears it', () => {
  const other = answered('first')
  const open = hold('gate', { feedback: 'old' })
  const saved = withFeedback([other, open], open, 'new')
  assert.strictEqual(saved.holds[0], other)
  assert.strictEqual(saved.holds[1], saved.record)
  assert.strictEqual(saved.record.feedback, 'new')
  const cleared = withFeedback(saved.holds, saved.record, '')
  assert.ok(!('feedback' in cleared.holds[1]))
})

test('rerollHold: the new candidates replace the old, the revision counts up, feedback stays', () => {
  const open = hold('gate', { feedback: 'less tragic' })
  const { record, holds } = rerollHold([open], open, '## Candidate 1\nC\n\n## Candidate 2\nD')
  assert.deepStrictEqual(record.candidates.map(c => c.body), ['C', 'D'])
  assert.strictEqual(record.revision, 2)
  assert.strictEqual(record.feedback, 'less tragic')
  assert.strictEqual(record.reachedAt, open.reachedAt)
  assert.ok(record.rerolledAt)
  assert.deepStrictEqual(holds, [record])
})

test('checkRevision: a stale revision is a conflict; the current one passes', () => {
  const open = hold('gate', { revision: 2 })
  assert.strictEqual(checkRevision(open, 2, { candidate: open.candidates[0] }), undefined)
  const stale = checkRevision(open, 1, { candidate: open.candidates[0] })
  assert.ok(stale && 'error' in stale)
  assert.strictEqual(stale.status, 409)
})

test('checkRevision: a candidate picked without a revision is refused only once a reroll replaced the set', () => {
  const pick = { candidate: hold('gate').candidates[0] }
  assert.strictEqual(checkRevision(hold('gate'), undefined, pick), undefined)
  assert.strictEqual(checkRevision(hold('gate', { revision: 2 }), undefined, pick), undefined)
  const rerolled = hold('gate', { revision: 2, rerolledAt: 't1' })
  assert.strictEqual(checkRevision(rerolled, undefined, pick)?.status, 409)
  assert.strictEqual(checkRevision(rerolled, undefined, { custom: 'mine' }), undefined)
  assert.strictEqual(checkRevision(rerolled, undefined, undefined), undefined)
})

test('selectOpenHold: only an open hold of a waiting run', () => {
  const open = hold('gate')
  assert.strictEqual(selectOpenHold(meta('waiting', [open]), 'gate'), open)
  assert.strictEqual((selectOpenHold(meta('complete', [open]), 'gate') as { status: number }).status, 409)
  assert.strictEqual((selectOpenHold(meta('waiting', [answered('gate')]), 'gate') as { status: number }).status, 409)
  assert.strictEqual((selectOpenHold(meta('waiting', [open]), 'nope') as { status: number }).status, 404)
})

test('readFeedback: text or absent; anything else is refused', () => {
  assert.strictEqual(readFeedback(undefined), undefined)
  assert.strictEqual(readFeedback(null), undefined)
  assert.strictEqual(readFeedback('  keep it  '), 'keep it')
  assert.strictEqual(readFeedback(''), '')
  assert.strictEqual((readFeedback(3) as { status: number }).status, 400)
})

test('readAnswerRequest: revision is a whole number when given', () => {
  const req = readAnswerRequest({ chosen: 'Candidate 1', revision: 2 })
  assert.ok(!('error' in req))
  assert.strictEqual(req.revision, 2)
  const refusal = readAnswerRequest({ chosen: 'Candidate 1', revision: 'two' })
  assert.ok('error' in refusal)
})
