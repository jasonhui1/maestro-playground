import { test } from 'vitest'
import assert from 'node:assert'
import { withHistory, canUndo, canRedo, History } from '../lib/history'

test('history', () => {
  type S = { n: number; sel: number }
  type A = { type: 'inc' } | { type: 'select'; v: number }
  const base = (s: S, a: A): S =>
    a.type === 'inc' ? { ...s, n: s.n + 1 } : { ...s, sel: a.v }
  const reducer = withHistory<S, A>(base, a => a.type !== 'select', 3)

  let h: History<S> = { past: [], present: { n: 0, sel: 0 }, future: [] }

  // a historic action pushes onto past
  h = reducer(h, { type: 'inc' })
  assert.strictEqual(h.present.n, 1)
  assert.ok(canUndo(h) && !canRedo(h))

  // undo restores, redo re-applies
  h = reducer(h, { type: 'undo' })
  assert.strictEqual(h.present.n, 0)
  assert.ok(canRedo(h))
  h = reducer(h, { type: 'redo' })
  assert.strictEqual(h.present.n, 1)

  // a non-historic action (select) does NOT create a history entry
  const before = h.past.length
  h = reducer(h, { type: 'select', v: 5 })
  assert.strictEqual(h.past.length, before)
  assert.strictEqual(h.present.sel, 5)

  // a new action clears the redo future
  h = reducer(h, { type: 'undo' })
  h = reducer(h, { type: 'inc' })
  assert.ok(!canRedo(h))

  // cap is enforced
  let c: History<S> = { past: [], present: { n: 0, sel: 0 }, future: [] }
  for (let i = 0; i < 10; i++) c = reducer(c, { type: 'inc' })
  assert.ok(c.past.length <= 3)
})
