import assert from 'node:assert'
import { normalizeOutputs } from '../lib/fs/parseAgent'

// undefined => implicit 'output' only (no summary)
assert.deepStrictEqual(normalizeOutputs(undefined), [{ name: 'output' }])

// string shorthand, in order, after implicit output
assert.deepStrictEqual(
  normalizeOutputs(['summary', 'characters']),
  [{ name: 'output' }, { name: 'summary' }, { name: 'characters' }]
)

// object (rich) form keeps type + description
assert.deepStrictEqual(
  normalizeOutputs([{ name: 'characters', type: 'json', description: 'array' }]),
  [{ name: 'output' }, { name: 'characters', type: 'json', description: 'array' }]
)

// hybrid mix
assert.deepStrictEqual(
  normalizeOutputs(['summary', { name: 'characters', type: 'json' }]),
  [{ name: 'output' }, { name: 'summary' }, { name: 'characters', type: 'json' }]
)

// dedupe by name + ignore junk
assert.deepStrictEqual(
  normalizeOutputs(['output', 'summary', 'summary', '', 42, { type: 'x' }]),
  [{ name: 'output' }, { name: 'summary' }]
)

console.log('✅ normalizeOutputs tests passed')
