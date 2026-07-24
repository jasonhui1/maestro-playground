import { test } from 'vitest'
import assert from 'node:assert'
import { normalizeInputs } from '../lib/fs/parseAgent'

test('inputs', () => {
  assert.deepStrictEqual(normalizeInputs(undefined), [])
  assert.deepStrictEqual(normalizeInputs(['world', 'characters']), [{ name: 'world' }, { name: 'characters' }])
  assert.deepStrictEqual(
    normalizeInputs([{ name: 'world', type: 'markdown', required: true }]),
    [{ name: 'world', type: 'markdown', required: true }]
  )
  assert.deepStrictEqual(
    normalizeInputs(['world', { name: 'lore', description: 'static' }, 'world', '', 7]),
    [{ name: 'world' }, { name: 'lore', description: 'static' }]
  )
})
