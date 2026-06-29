// tests/tab-clamp.test.ts
import assert from 'node:assert'
import { clampTab } from '../lib/tabClamp'

assert.strictEqual(clampTab('validation', ['output', 'validation', 'history']), 'validation')
// agent view: no validation tab -> fall back to first available
assert.strictEqual(clampTab('validation', ['output', 'history']), 'output')
// non-runnable view: history only
assert.strictEqual(clampTab('output', ['history']), 'history')
// empty (defensive) -> history
assert.strictEqual(clampTab('output', []), 'history')

console.log('✅ tab-clamp tests passed')
