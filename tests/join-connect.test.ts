import assert from 'node:assert'
import { connectEdge } from '../lib/editorOps'
import { applyEditorAction, EditorState } from '../lib/editorReducer'
import { ChainEdge, ChainNode } from '../lib/types'

const e = (from: string, to: string, toSocket: string): ChainEdge =>
  ({ fromNode: from, fromSocket: 'output', toNode: to, toSocket })

// default (non-join): a 2nd edge into the same slot REPLACES the 1st
{
  const out = connectEdge([e('a', 'x', 'in')], e('b', 'x', 'in'))
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].fromNode, 'b')
}
// allowMulti (join): a 2nd edge into the same slot is KEPT alongside
{
  const out = connectEdge([e('a', 'j', 'in')], e('b', 'j', 'in'), true)
  assert.deepStrictEqual(out.map(x => x.fromNode), ['a', 'b'])
}
// allowMulti still de-dups an EXACT duplicate
{
  const out = connectEdge([e('a', 'j', 'in')], e('a', 'j', 'in'), true)
  assert.strictEqual(out.length, 1)
}
// the reducer routes join targets to allowMulti
{
  const nodes: ChainNode[] = [
    { id: 'a', kind: 'agent', agent: 'x' }, { id: 'b', kind: 'agent', agent: 'y' }, { id: 'j', kind: 'join' },
  ]
  let state: EditorState = { nodes, edges: [e('a', 'j', 'in')], selectedIds: [], clipboard: null }
  state = applyEditorAction(state, { type: 'connect', edge: e('b', 'j', 'in') })
  assert.strictEqual(state.edges.length, 2, 'reducer keeps both edges into a join')
}
console.log('✅ join connect tests passed')
