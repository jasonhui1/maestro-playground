import { test } from 'vitest'
import assert from 'node:assert'
import { declaresSeed, groupChains, pinnedFiles, runBlockedReason } from '../lib/launchForm'
import { buildRunFrame } from '../lib/runFrame'
import type { ChainDef } from '../lib/types'

function chain(over: Partial<ChainDef> = {}): ChainDef {
  return {
    slug: 'relay', name: 'relay', description: '', nodes: [], edges: [],
    filePath: '', isFavorite: false, ...over,
  }
}

const seeded = chain({
  slug: 'wrong-audience', name: 'wrong audience', moment: 'finalizing a doc',
  nodes: [{ id: 'seed', kind: 'seed' }],
  view: 'timeline', outputs: [{ name: 'finding', node: 'a', socket: 'summary' }],
})

const pinnedToFile = chain({
  slug: 'premortem', name: 'premortem', description: 'surface the failure first',
  nodes: [{ id: 'ctx', kind: 'context', file: 'vision.md' }],
})

test('a chain reads pasted text only when it declares a seed node', () => {
  assert.equal(declaresSeed(seeded), true)
  assert.equal(declaresSeed(pinnedToFile), false)
  assert.deepEqual(pinnedFiles(pinnedToFile), ['vision.md'])
})

// Both halves of the declaration are required: `outputs` names the panels, `view`
// places them. A chain with ports and no view still comes back as the run trace.
test('a row says whether the chain will draw the panels it declares', () => {
  const portsOnly = chain({ slug: 'refine-loop', name: 'refine loop', outputs: [{ name: 'p', node: 'a' }] })
  const rows = groupChains([seeded, pinnedToFile, portsOnly]).groups.flatMap(g => g.rows)
  assert.deepEqual(rows.filter(r => r.panels).map(r => r.chain.slug), ['wrong-audience'])
  assert.deepEqual(rows.filter(r => !r.panels).map(r => r.chain.slug), ['premortem', 'refine-loop'])
})

// ADR-0016 rule 1: the three purpose headings render whether or not they have members,
// and a chain declaring none falls to the fourth rather than into a group it never chose.
test('the picker groups by declared purpose, empty headings included', () => {
  const groups = groupChains([chain({ slug: 'a', purpose: 'insight' }), chain({ slug: 'b' })])
  assert.deepEqual(groups.groups.map(g => g.heading),
    ['洞見 (insight)', '產出 (production)', '壓力測試 (stress-test)', 'unclassified'])
  assert.deepEqual(groups.groups.map(g => g.rows.map(r => r.chain.slug)), [['a'], [], [], ['b']])
  assert.equal(groups.total, 2)
})

// The row keeps the chain's own words as well: the pinned file is what it reads, not
// what it is for (ADR-0016).
test('a trace row carries both the moment and the file it reads', () => {
  const [row] = groupChains([pinnedToFile]).groups[3].rows
  assert.deepEqual(row.pinned, ['vision.md'])
  assert.equal(row.note, 'surface the failure first')
  assert.deepEqual(groupChains([seeded]).groups[3].rows[0].pinned, [])
})

test('the filter matches name, slug, moment and description, and reports the count', () => {
  const groups = groupChains([seeded, pinnedToFile], 'finaliz')
  assert.equal(groups.shown, 1)
  assert.equal(groups.total, 2)
  assert.equal(groups.groups.flatMap(g => g.rows)[0].chain.slug, 'wrong-audience')
})

test('Run names the one thing it is waiting for', () => {
  const base = { mode: 'paste' as const, seedText: '', paramValue: '' }
  assert.equal(runBlockedReason({ ...base }), 'pick a chain')
  assert.equal(runBlockedReason({ ...base, chain: seeded }), 'paste the text this chain reads')
  assert.equal(runBlockedReason({ ...base, chain: seeded, mode: 'file' }), 'pick a context file')
  assert.equal(runBlockedReason({ ...base, chain: seeded, seedText: 'a draft' }), null)
})

// The four chains that read a pinned file must not be gated on text the run discards.
test('a chain with no seed node is runnable with no text at all', () => {
  assert.equal(runBlockedReason({ chain: pinnedToFile, mode: 'paste', seedText: '', paramValue: '' }), null)
})

test('a declared parameter blocks Run by its own name', () => {
  const withParam = chain({
    ...seeded, parameter: { name: 'target audience', options: ['engineers', 'execs'], node: 'param' },
  })
  const blocked = runBlockedReason({ chain: withParam, mode: 'paste', seedText: 'a draft', paramValue: '' })
  assert.equal(blocked, 'choose target audience')
})

// The rail must not say "pasted text" for a chain the run hands no seed at all — the
// failure class #65 exists to close.
test('the frame names the pinned files a seedless chain reads', () => {
  const frame = buildRunFrame({
    chain: chain({ name: 'premortem' }),
    seed: { kind: 'pinned', files: ['vision.md'] },
    states: {}, startedAt: 0, endedAt: 1, now: 1,
  })
  assert.equal(frame.seedSource, 'vision.md (pinned by the chain)')
})
