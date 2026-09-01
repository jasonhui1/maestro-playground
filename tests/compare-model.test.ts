import { test } from 'vitest'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { buildCompareModel, COMPARE_MODES, CompareSpan } from '../lib/compareModel'
import { buildLayoutModel } from '../lib/layoutModel'
import { parseChainContent } from '../lib/parseChain'
import type { AgentOutput, ChainDef } from '../lib/types'

const textOf = (spans: CompareSpan[], kind: CompareSpan['kind']) =>
  spans.filter(s => s.kind === kind).map(s => s.text).join('')

test('two blobs are not enough to compare against fewer than one other', () => {
  assert.strictEqual(buildCompareModel([]), null)
  assert.strictEqual(buildCompareModel([{ name: 'only', text: 'a' }]), null)
})

test('the base reads exactly as it was produced, carrying no diff marks', () => {
  const model = buildCompareModel([
    { name: 'optimist', text: 'Ship it in Q1. The team is ready.' },
    { name: 'skeptic', text: 'Ship it in Q3. Hiring comes first.' },
  ])!
  assert.strictEqual(model.base.name, 'optimist')
  assert.deepStrictEqual(model.base.spans, [{ kind: 'same', text: 'Ship it in Q1. The team is ready.' }])
})

test('each column carries what it cut from the base and what it put there instead', () => {
  const model = buildCompareModel([
    { name: 'optimist', text: 'Ship it in Q1. The team is ready.' },
    { name: 'skeptic', text: 'Ship it in Q3. Hiring comes first.' },
  ])!
  const [skeptic] = model.columns
  assert.strictEqual(skeptic.name, 'skeptic')
  assert.strictEqual(textOf(skeptic.spans, 'cut'), '1The team is ready')
  assert.strictEqual(textOf(skeptic.spans, 'added'), '3Hiring comes first')
  // Dropping the additions rebuilds the base; dropping the cuts rebuilds the column.
  assert.strictEqual(
    skeptic.spans.filter(s => s.kind !== 'added').map(s => s.text).join(''),
    'Ship it in Q1. The team is ready.',
  )
  assert.strictEqual(
    skeptic.spans.filter(s => s.kind !== 'cut').map(s => s.text).join(''),
    'Ship it in Q3. Hiring comes first.',
  )
})

// The point of the plain base (#71): a third column changes nothing about the
// second, so five personas read the same way two hops do.
test('columns are independent of each other', () => {
  const sources = [
    { name: 'optimist', text: 'Ship it in Q1. The team is ready.' },
    { name: 'skeptic', text: 'Ship it in Q3. The team is ready.' },
  ]
  const pair = buildCompareModel(sources)!
  const trio = buildCompareModel([...sources, { name: 'cynic', text: 'Nobody will use it.' }])!
  assert.deepStrictEqual(trio.columns[0], pair.columns[0])
  assert.deepStrictEqual(trio.base, pair.base)
  assert.strictEqual(trio.columns.length, 2)
})

test('a column identical to the base is all agreement', () => {
  const model = buildCompareModel([
    { name: 'a', text: 'the same words' },
    { name: 'b', text: 'the same words' },
  ])!
  assert.deepStrictEqual(model.columns[0].spans, [{ kind: 'same', text: 'the same words' }])
})

test('an empty blob against a full one is all cut, and the reverse all added', () => {
  const dropped = buildCompareModel([{ name: 'a', text: 'words' }, { name: 'b', text: '' }])!
  assert.strictEqual(textOf(dropped.columns[0].spans, 'cut'), 'words')
  const grown = buildCompareModel([{ name: 'a', text: '' }, { name: 'b', text: 'words' }])!
  assert.strictEqual(textOf(grown.columns[0].spans, 'added'), 'words')
})

test('only the base mode is built; the shared mode is declared and disabled', () => {
  assert.deepStrictEqual(COMPARE_MODES.map(m => m.id), ['base', 'shared'])
  assert.deepStrictEqual(COMPARE_MODES.map(m => m.enabled), [true, false])
})

// The chain #71 ships: two columns whose whole point is the comparison between them.
test('a write-the-opposite run compares as written against the other way', () => {
  const chain = parseChainContent(
    readFileSync('workspace/chains/write-the-opposite.md', 'utf8'),
    'write-the-opposite',
  )
  const out = (nodeId: string, text: string): AgentOutput => ({
    nodeId, agentName: 'Write the Opposite', systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  })
  // Both panels read a report node: the seed on one side, the inverter's output on the
  // other, so the comparison is between two outputs rather than an output and a form.
  const layout = buildLayoutModel(chain, [
    out('as-written', 'Explicit wiring is worth its cost. Every input arrives through a named slot.'),
    out('the-other-way', 'Explicit wiring is not worth its cost. Every input arrives through a named slot.'),
  ])
  assert.strictEqual(layout.kind, 'columns')

  // The overlay hands the builder panel text and nothing else about the layout.
  const model = buildCompareModel(layout.panels.map(p => ({ name: p.name, text: p.text })))!
  assert.deepStrictEqual([model.base.name, model.columns[0].name], ['as written', 'the other way'])
  // The sentence they share is unmarked; the reversal is the only thing highlighted.
  assert.ok(textOf(model.columns[0].spans, 'same').includes('Every input arrives through a named slot.'))
  assert.strictEqual(textOf(model.columns[0].spans, 'added'), 'not ')
  assert.strictEqual(textOf(model.columns[0].spans, 'cut'), '')
})

// "The same overlay works unchanged on timeline, columns+join and sidebar" (#71): the
// overlay hands the builder panel text, so the three layouts differ only in which
// panels a reader ticked — never in what compare then does with them.
test('the same two blobs compare identically whatever layout produced them', () => {
  const out = (nodeId: string, text: string, round?: number): AgentOutput => ({
    nodeId, agentName: 'a', systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', round,
  })
  const base = (over: Partial<ChainDef>): ChainDef =>
    ({ slug: 'c', name: 'c', description: '', nodes: [], edges: [], filePath: '', isFavorite: false, ...over })

  const timeline = buildLayoutModel(
    base({ view: 'timeline', outputs: [{ name: 'hop 1', node: 'a' }, { name: 'hop 2', node: 'b' }] }),
    [out('a', 'Ship it in Q1.'), out('b', 'Ship it in Q3.')],
  )
  const columns = buildLayoutModel(
    base({ view: 'columns', outputs: [{ name: 'hop 1', node: 'a' }, { name: 'hop 2', node: 'b', role: 'join' }] }),
    [out('a', 'Ship it in Q1.'), out('b', 'Ship it in Q3.')],
  )
  // Sidebar panels are a loop's rounds, so their names carry the round; compare the spans.
  const sidebar = buildLayoutModel(
    base({ view: 'sidebar', outputs: [{ name: 'hop', node: 'a' }] }),
    [out('a', 'Ship it in Q1.', 0), out('a', 'Ship it in Q3.', 1)],
  )

  const compare = (m: { panels: { name: string; text: string }[] }) =>
    buildCompareModel(m.panels.map(p => ({ name: p.name, text: p.text })))!
  assert.deepStrictEqual(compare(timeline), compare(columns))
  assert.deepStrictEqual(compare(sidebar).columns[0].spans, compare(timeline).columns[0].spans)
  assert.deepStrictEqual(compare(sidebar).base.spans, compare(timeline).base.spans)
})
