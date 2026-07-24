import { test } from 'vitest'
import assert from 'node:assert'
import { applyEditorAction, EditorState } from '../lib/editorReducer'
import { ChainNode, ChainEdge } from '../lib/types'

test('editor-reducer', () => {
  const base: EditorState = {
    nodes: [{ id: 'a', kind: 'seed' }, { id: 'b', kind: 'agent', agent: 'x' }],
    edges: [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' }],
    selectedIds: [], clipboard: null,
  }

  // addNode appends, original state is untouched (purity)
  const added = applyEditorAction(base, { type: 'addNode', node: { id: 'c', kind: 'gate' } })
  assert.strictEqual(added.nodes.length, 3)
  assert.strictEqual(base.nodes.length, 2)

  // deleteNode removes incident edges and deselects
  const sel = { ...base, selectedIds: ['b'] }
  const del = applyEditorAction(sel, { type: 'deleteNode', id: 'b' })
  assert.strictEqual(del.nodes.length, 1)
  assert.strictEqual(del.edges.length, 0)
  assert.deepStrictEqual(del.selectedIds, [])

  // updateNode patches in place
  const up = applyEditorAction(base, { type: 'updateNode', id: 'b', patch: { agent: 'y' } })
  assert.strictEqual((up.nodes.find(n => n.id === 'b')! as Extract<ChainNode, { kind: 'agent' }>).agent, 'y')

  // moveMany updates several positions
  const mv = applyEditorAction(base, { type: 'moveMany', updates: [{ id: 'a', pos: [5, 5] }, { id: 'b', pos: [9, 9] }] })
  assert.deepStrictEqual(mv.nodes.find(n => n.id === 'a')!.pos, [5, 5])

  // copy then paste duplicates with fresh ids
  const copied = applyEditorAction({ ...base, selectedIds: ['a', 'b'] }, { type: 'copy', ids: ['a', 'b'] })
  assert.ok(copied.clipboard && copied.clipboard.nodes.length === 2)
  const pasted = applyEditorAction(copied, { type: 'paste' })
  assert.strictEqual(pasted.nodes.length, 4)
  assert.strictEqual(pasted.selectedIds.length, 2)

  // regression: addLoopZone must mint a zone id against reservedIds (node ids AND zone
  // ids), so a second loop never collides with an existing zone (which would merge them).
  const oneLoop: EditorState = {
    nodes: [
      { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
      { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
    ],
    edges: [], selectedIds: [], clipboard: null,
  }
  const twoLoops = applyEditorAction(oneLoop, { type: 'addLoopZone', pos: [120, 120] })
  const newZones = twoLoops.nodes.slice(2).map(n => n.zone)
  assert.ok(newZones.every(z => z && z !== 'zone-1'), 'second loop zone must not reuse zone-1')

  // regression: pasting a copied loop back into its own graph must not reuse the source zone.
  const loopClip = applyEditorAction({ ...oneLoop, selectedIds: ['loop-start-1', 'loop-end-1'] }, { type: 'copy', ids: ['loop-start-1', 'loop-end-1'] })
  const loopPasted = applyEditorAction(loopClip, { type: 'paste' })
  const pastedZones = loopPasted.nodes.slice(2).map(n => n.zone)
  assert.ok(pastedZones.every(z => z && z !== 'zone-1'), 'pasted loop zone must be fresh, not zone-1')

  // regression: setSelection returns the SAME state when the id set is unchanged, so the
  // history reducer can bail out instead of churning renders.
  const sameSel: EditorState = { ...base, selectedIds: ['a'] }
  assert.strictEqual(applyEditorAction(sameSel, { type: 'setSelection', ids: ['a'] }), sameSel)
  assert.notStrictEqual(applyEditorAction(sameSel, { type: 'setSelection', ids: ['b'] }), sameSel)
})
