import { test } from 'vitest'
import assert from 'node:assert'
import { extractSection } from '../lib/graph'
import { sliceCandidates } from '../lib/hold'

test('section', () => {
  const md = `Intro
## Summary
key facts here
## Characters
- Aria
## Geography
mountains`
  assert.strictEqual(extractSection(md, 'summary'), 'key facts here')
  assert.strictEqual(extractSection(md, 'Characters'), '- Aria')           // slug match, case-insensitive
  assert.strictEqual(extractSection(md, 'geography'), 'mountains')
  assert.strictEqual(extractSection(md, 'missing'), '')
})

test('sliceCandidates keeps only `## Candidate N` sections, heading as written', () => {
  const md = `Verdict.
## Why
because
## Candidate 1
one
## candidate 2
two
more
## Candidates
not one
## Candidate 3`
  assert.deepStrictEqual(sliceCandidates(md), [
    { heading: 'Candidate 1', body: 'one' },
    { heading: 'candidate 2', body: 'two\nmore' },
    { heading: 'Candidate 3', body: '' },
  ])
  assert.deepStrictEqual(sliceCandidates('no headings'), [])
})
