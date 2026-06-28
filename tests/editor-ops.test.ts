import assert from 'node:assert'
import { uniqueNodeId, connectEdge, deleteNode, deleteEdge, makeLoopZone } from '../lib/editorOps'
import { ChainEdge } from '../lib/types'

// uniqueNodeId increments until free
assert.strictEqual(uniqueNodeId('agent', []), 'agent-1')
assert.strictEqual(uniqueNodeId('agent', ['agent-1', 'agent-2']), 'agent-3')

// connectEdge replaces an existing edge into the same input socket
const e1: ChainEdge = { fromNode: 'a', fromSocket: 'output', toNode: 'c', toSocket: 'input' }
const e2: ChainEdge = { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'input' }
const after = connectEdge([e1], e2)
assert.strictEqual(after.length, 1)
assert.deepStrictEqual(after[0], e2)

// connectEdge keeps edges into a different socket
const e3: ChainEdge = { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'other' }
assert.strictEqual(connectEdge([e1], e3).length, 2)

// deleteNode removes the node and all incident edges
const del = deleteNode(
  [{ id: 'a', kind: 'seed' }, { id: 'c', kind: 'agent', agent: 'x' }],
  [e1],
  'c',
)
assert.strictEqual(del.nodes.length, 1)
assert.strictEqual(del.edges.length, 0)

// deleteEdge removes only the exact edge
assert.strictEqual(deleteEdge([e1, e3], e1).length, 1)

// makeLoopZone creates a paired start/end sharing one zone id, unique ids
const pair = makeLoopZone([], [100, 200])
assert.strictEqual(pair.length, 2)
assert.strictEqual(pair[0].kind, 'loop-start')
assert.strictEqual(pair[1].kind, 'loop-end')
assert.strictEqual(pair[0].zone, pair[1].zone)
assert.notStrictEqual(pair[0].id, pair[1].id)
assert.deepStrictEqual(pair[0].pos, [100, 200])

console.log('✅ editor-ops tests passed')
