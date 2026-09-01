import { test } from 'vitest'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { buildSharedModel, COMPARE_MODES } from '../lib/compareModel'
import type { SharedColumn, SharedSpan } from '../lib/compareModel'
import { buildLayoutModel } from '../lib/layoutModel'
import { parseChainContent } from '../lib/parseChain'
import type { AgentOutput } from '../lib/types'

const textOf = (spans: SharedSpan[], kind: SharedSpan['kind']) =>
  spans.filter(s => s.kind === kind).map(s => s.text).join('')
const sharedOf = (column: SharedColumn) => textOf(column.spans, 'shared').trim()
const ownOf = (column: SharedColumn) => textOf(column.spans, 'own').trim()

test('one blob has nothing to share with', () => {
  assert.strictEqual(buildSharedModel([]), null)
  assert.strictEqual(buildSharedModel([{ name: 'only', text: 'a' }]), null)
})

test('the mode works at exactly two panels, not only at three', () => {
  const model = buildSharedModel([
    { name: 'a', text: 'The claim rests on adoption, but nobody asked the users.' },
    { name: 'b', text: 'The claim rests on adoption, though the TAM is soft.' },
  ])!
  assert.strictEqual(model.columns.length, 2)
  assert.ok(model.columns.every(c => sharedOf(c).startsWith('The claim rests on adoption,')))
  assert.ok(ownOf(model.columns[0]).includes('nobody asked'))
  assert.ok(ownOf(model.columns[1]).includes('TAM is soft'))
})

// The reason #74 is not N-1 pairwise diffs: what dims is the reading *every* panel
// carries, so a phrase four of five share is still that panel's own divergence.
test('shared means every panel, not merely some other panel', () => {
  const model = buildSharedModel([
    { name: 'a', text: 'we ship now' },
    { name: 'b', text: 'we ship later' },
    { name: 'c', text: 'we hold now' },
  ])!
  assert.deepStrictEqual(model.columns.map(sharedOf), ['we', 'we', 'we'])
  assert.deepStrictEqual(model.columns.map(ownOf), ['ship now', 'ship later', 'hold now'])
})

test('panels that agree word for word are entirely shared', () => {
  const model = buildSharedModel([
    { name: 'a', text: 'the same words' },
    { name: 'b', text: 'the same words' },
    { name: 'c', text: 'the same words' },
  ])!
  for (const column of model.columns) {
    assert.deepStrictEqual(column.spans, [{ kind: 'shared', text: 'the same words' }])
  }
})

test('panels with no word in common are entirely their own', () => {
  const model = buildSharedModel([
    { name: 'a', text: 'alpha beta' },
    { name: 'b', text: 'gamma delta' },
  ])!
  assert.deepStrictEqual(model.columns.map(ownOf), ['alpha beta', 'gamma delta'])
  assert.deepStrictEqual(model.columns.map(sharedOf), ['', ''])
})

// Dimming is a mark on the panel, never a rewrite of it.
test('every column reads back as the text it was built from', () => {
  const sources = [
    { name: 'a', text: '  The claim rests on adoption.\n\nBut nobody asked.  ' },
    { name: 'b', text: 'The claim rests on nothing.\n\nThe TAM is soft.' },
    { name: 'c', text: '' },
  ]
  const model = buildSharedModel(sources)!
  model.columns.forEach((column, i) => {
    assert.strictEqual(column.spans.map(s => s.text).join(''), sources[i].text)
    assert.strictEqual(column.name, sources[i].name)
  })
})

test('adjacent tokens of one kind merge into a single span', () => {
  const model = buildSharedModel([
    { name: 'a', text: 'we all agree on this one point exactly' },
    { name: 'b', text: 'we all agree on this one point exactly' },
  ])!
  assert.strictEqual(model.columns[0].spans.length, 1)
})

test('both modes are built now', () => {
  assert.deepStrictEqual(COMPARE_MODES.map(m => m.id), ['base', 'shared'])
  assert.deepStrictEqual(COMPARE_MODES.map(m => m.enabled), [true, true])
})

// The 骨架 question: what survived five hostile readings.
test('a five-personas run dims the shared reading across all five columns', () => {
  const chain = parseChainContent(readFileSync('workspace/chains/five-personas.md', 'utf8'), 'five-personas')
  const spine = 'The proposal turns on whether teams adopt it. '
  const stances: [string, string][] = [
    ['optimist', 'Given the pull we already see, that is nearly free.'],
    ['skeptic', 'Nobody has costed a training budget for it.'],
    ['pragmatist', 'Everything hinges on a migration path, still unwritten.'],
    ['cynic', 'It will stall the moment its champion leaves.'],
    ['visionary', 'Wrong question; category creation is the real one.'],
  ]
  const out = (nodeId: string, text: string): AgentOutput => ({
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  })
  const layout = buildLayoutModel(chain, stances.map(([id, tail]) => out(id, spine + tail)))
  // Only the five stance panels are ticked — the synthesis is not one of the readings.
  const stancePanels = layout.panels.filter(p => stances.some(([id]) => id === p.name))
  assert.strictEqual(stancePanels.length, 5)

  const model = buildSharedModel(stancePanels.map(p => ({ name: p.name, text: p.text })))!
  assert.strictEqual(model.columns.length, 5)
  for (const column of model.columns) {
    assert.strictEqual(sharedOf(column), spine.trim())
  }
  assert.ok(ownOf(model.columns[3]).includes('champion leaves'))
})

// No base means no side: which panel a reader ticked first cannot change the reading.
// Rotations are the case that catches it — every word is common to all three, so a
// fold that started from whichever panel was ticked first would keep a different one.
test('rotations of the same words read the same whatever the tick order', () => {
  const sources = [
    { name: 'a', text: 'one two three' },
    { name: 'b', text: 'three one two' },
    { name: 'c', text: 'two three one' },
  ]
  const shared = (m: { columns: SharedColumn[] }) =>
    Object.fromEntries(m.columns.map(c => [c.name, sharedOf(c)]))
  assert.deepStrictEqual(shared(buildSharedModel([...sources].reverse())!), shared(buildSharedModel(sources)!))
  assert.deepStrictEqual(shared(buildSharedModel([sources[1], sources[2], sources[0]])!), shared(buildSharedModel(sources)!))
})

test('the reading does not depend on the order the panels were ticked', () => {
  const sources = [
    { name: 'a', text: 'The proposal turns on adoption. It looks easy.' },
    { name: 'b', text: 'The proposal turns on adoption. It assumes a budget.' },
    { name: 'c', text: 'The proposal turns on adoption. It stalls without a champion.' },
  ]
  const forward = buildSharedModel(sources)!
  const reversed = buildSharedModel([...sources].reverse())!
  const byName = (m: { columns: SharedColumn[] }) =>
    Object.fromEntries(m.columns.map(c => [c.name, c.spans]))
  assert.deepStrictEqual(byName(reversed), byName(forward))
})
