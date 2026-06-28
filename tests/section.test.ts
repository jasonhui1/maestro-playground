import assert from 'node:assert'
import { extractSection } from '../lib/graph'

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
console.log('✅ extractSection tests passed')
