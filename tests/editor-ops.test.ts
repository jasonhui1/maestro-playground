import assert from 'node:assert'
import { uniqueNodeId, connectEdge, deleteNode, deleteEdge, makeLoopZone, copySubgraph, pasteSubgraph, reservedIds } from '../lib/editorOps'
import type { Subgraph } from '../lib/editorOps'
import { ChainEdge, ChainNode } from '../lib/types'

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

// --- §2.5 clipboard ---

// copySubgraph keeps only edges internal to the selection
const csNodes: ChainNode[] = [
  { id: 'a', kind: 'seed' },
  { id: 'b', kind: 'agent', agent: 'x', pos: [10, 20] },
  { id: 'c', kind: 'agent', agent: 'y' },
]
const csEdges: ChainEdge[] = [
  { fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' },
  { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'input' },
]
const clip = copySubgraph(csNodes, csEdges, ['b', 'c'])
assert.strictEqual(clip.nodes.length, 2)
assert.strictEqual(clip.edges.length, 1)            // only b->c is internal
assert.strictEqual(clip.edges[0].fromNode, 'b')

// pasteSubgraph mints fresh ids (no collision), remaps edges, offsets pos
const pasted = pasteSubgraph(clip, ['b', 'c'], [40, 40])
assert.strictEqual(pasted.nodes.length, 2)
assert.ok(!pasted.newIds.includes('b') && !pasted.newIds.includes('c'))
assert.ok(pasted.newIds.includes(pasted.edges[0].fromNode))
assert.ok(pasted.newIds.includes(pasted.edges[0].toNode))
const pb = pasted.nodes.find(n => n.kind === 'agent' && n.agent === 'x')!
assert.deepStrictEqual(pb.pos, [50, 60])            // [10,20] + [40,40]

// pasteSubgraph mints a fresh, shared zone id for a copied loop pair
const loopClip: Subgraph = {
  nodes: [
    { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
    { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
  ],
  edges: [],
}
const loopPasted = pasteSubgraph(loopClip, ['loop-start-1', 'loop-end-1', 'zone-1'], [0, 0])
assert.strictEqual(loopPasted.nodes[0].zone, loopPasted.nodes[1].zone)  // shared
assert.notStrictEqual(loopPasted.nodes[0].zone, 'zone-1')               // fresh

// reservedIds spans node ids AND the distinct zone ids they reference (deduped)
const zonedNodes: ChainNode[] = [
  { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
  { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
  { id: 'a', kind: 'agent', agent: 'x' },
]
const reserved = reservedIds(zonedNodes)
assert.ok(reserved.includes('loop-start-1') && reserved.includes('a'))
assert.ok(reserved.includes('zone-1'))
assert.strictEqual(reserved.filter(id => id === 'zone-1').length, 1)    // deduped

// regression: pasting a loop back into its own graph must NOT reuse the source zone.
// The real caller passes reservedIds(nodes); node-ids alone would hand back 'zone-1'.
const selfClip = copySubgraph(zonedNodes, [], ['loop-start-1', 'loop-end-1'])
const selfPaste = pasteSubgraph(selfClip, reservedIds(zonedNodes), [40, 40])
assert.notStrictEqual(selfPaste.nodes[0].zone, 'zone-1')               // fresh, not the source zone
assert.strictEqual(selfPaste.nodes[0].zone, selfPaste.nodes[1].zone)   // still shared within the pasted pair

console.log('✅ editor-ops tests passed')
