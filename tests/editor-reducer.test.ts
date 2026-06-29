import assert from 'node:assert'
import { applyEditorAction, EditorState } from '../lib/editorReducer'
import { ChainNode, ChainEdge } from '../lib/types'

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
assert.strictEqual(up.nodes.find(n => n.id === 'b')!.agent, 'y')

// moveMany updates several positions
const mv = applyEditorAction(base, { type: 'moveMany', updates: [{ id: 'a', pos: [5, 5] }, { id: 'b', pos: [9, 9] }] })
assert.deepStrictEqual(mv.nodes.find(n => n.id === 'a')!.pos, [5, 5])

// copy then paste duplicates with fresh ids
const copied = applyEditorAction({ ...base, selectedIds: ['a', 'b'] }, { type: 'copy', ids: ['a', 'b'] })
assert.ok(copied.clipboard && copied.clipboard.nodes.length === 2)
const pasted = applyEditorAction(copied, { type: 'paste' })
assert.strictEqual(pasted.nodes.length, 4)
assert.strictEqual(pasted.selectedIds.length, 2)

console.log('✅ editor-reducer tests passed')
