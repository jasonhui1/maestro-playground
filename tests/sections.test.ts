import assert from 'node:assert'
import { slugify, extractSections } from '../lib/graph'

assert.strictEqual(slugify('  Character List  '), 'character-list')
assert.strictEqual(slugify('Summary'), 'summary')

const md = `Intro text
## Summary
- a
### Character List
words
# Geography
more`
assert.deepStrictEqual(extractSections(md), ['summary', 'character-list', 'geography'])

// no headings
assert.deepStrictEqual(extractSections('just prose'), [])

console.log('✅ sections tests passed')
