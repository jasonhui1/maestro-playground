import { test } from 'vitest'
import assert from 'node:assert'
import { compareOrder, previewOf, toggleSelection } from '../lib/panelDeck'

test('a preview is the lead of the content, and says so when there is more', () => {
  const long = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
  const preview = previewOf(long, 4)
  assert.strictEqual(preview.lead, 'line 1\nline 2\nline 3\nline 4')
  assert.strictEqual(preview.truncated, true)

  const short = previewOf('line 1\nline 2', 4)
  assert.strictEqual(short.lead, 'line 1\nline 2')
  assert.strictEqual(short.truncated, false)
})

// Compare diffs every other panel against the first one selected (#71), so the
// order a reader ticked the boxes in has to survive.
test('selection keeps the order panels were ticked in', () => {
  let selected = toggleSelection([], 2)
  selected = toggleSelection(selected, 0)
  assert.deepStrictEqual(selected, [2, 0])

  selected = toggleSelection(selected, 2)
  assert.deepStrictEqual(selected, [0])
})

test('compare reads the base first, and re-bases when the base is unticked', () => {
  assert.deepStrictEqual(compareOrder([2, 0, 3], null), [2, 0, 3])
  assert.deepStrictEqual(compareOrder([2, 0, 3], 3), [3, 2, 0])
  // The base was ticked off from the overlay header; the first survivor takes over.
  assert.deepStrictEqual(compareOrder([2, 0], 3), [2, 0])
  assert.deepStrictEqual(compareOrder([], 1), [])
})
