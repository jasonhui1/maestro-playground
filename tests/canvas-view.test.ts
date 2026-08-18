import { test } from 'vitest'
import assert from 'node:assert'
import type { Node, NodeChange } from '@xyflow/react'
import { applyViewChanges, emptyCanvasView, overlay } from '../lib/canvasView'

test('applyViewChanges: only what React Flow owns, and only when it changed', () => {
  let v = emptyCanvasView()

  // a drag in progress parks the live position on the overlay
  v = applyViewChanges(v, [{ id: 'a', type: 'position', position: { x: 10, y: 20 }, dragging: true }])
  assert.deepStrictEqual(v.drag.a, { position: { x: 10, y: 20 } })

  // measuring records the size — the chain has no field for it, and React Flow
  // re-measures forever if a re-projection drops it
  v = applyViewChanges(v, [{ id: 'a', type: 'dimensions', dimensions: { width: 100, height: 40 } }])
  assert.deepStrictEqual(v.measured.a, { measured: { width: 100, height: 40 } })

  // the same size reported again must not produce a new overlay: the render it would
  // trigger reports the same size again, which is the loop this whole shape avoids
  const settled = v
  v = applyViewChanges(v, [{ id: 'a', type: 'dimensions', dimensions: { width: 100, height: 40 } }])
  assert.strictEqual(v, settled, 'unchanged dimensions keep identity')

  // a drag leaves the measurements alone, so nodes not being dragged keep their identity
  v = applyViewChanges(v, [{ id: 'a', type: 'position', position: { x: 11, y: 21 }, dragging: true }])
  assert.strictEqual(v.measured, settled.measured, 'the two layers move independently')

  // drag over: the chain now holds the landing position, so the overlay lets go of it
  v = applyViewChanges(v, [{ id: 'a', type: 'position', position: { x: 11, y: 21 }, dragging: false }])
  assert.strictEqual(v.drag.a, undefined)
  assert.deepStrictEqual(v.measured.a, { measured: { width: 100, height: 40 } }, 'measurement survives')

  // ...and letting go twice is not a change
  const released = v
  assert.strictEqual(applyViewChanges(v, [{ id: 'a', type: 'position', dragging: false }]), released)

  // selection and structural edits are the chain's, not the overlay's
  const ignored: NodeChange[] = [
    { id: 'a', type: 'select', selected: true },
    { id: 'a', type: 'remove' },
  ]
  assert.strictEqual(applyViewChanges(v, ignored), released)
})

test('overlay: only patched nodes are rebuilt', () => {
  const node = (id: string): Node => ({ id, type: 'agent', position: { x: 0, y: 0 }, data: {} })
  const a = node('a'), b = node('b')
  const base = [a, b]

  // no patch at all: the projection passes through as the very same array
  assert.strictEqual(overlay(base, {}), base)

  // dragging `a` rebuilds `a` only — `b` is handed back the same object, so React
  // Flow's own equality check skips it
  const dragged = overlay(base, { a: { position: { x: 5, y: 5 } } })
  assert.deepStrictEqual(dragged[0].position, { x: 5, y: 5 })
  assert.strictEqual(dragged[1], b, 'the node not being dragged is untouched')

  // layering: measurements first, then the drag, so a gesture leaves the rest alone
  const measured = overlay(base, { a: { measured: { width: 9, height: 9 } }, b: { measured: { width: 9, height: 9 } } })
  const live = overlay(measured, { a: { position: { x: 5, y: 5 } } })
  assert.strictEqual(live[1], measured[1], 'measured node survives a drag of its neighbour')
  assert.deepStrictEqual(live[0].measured, { width: 9, height: 9 }, 'the drag layer does not drop it')
})
