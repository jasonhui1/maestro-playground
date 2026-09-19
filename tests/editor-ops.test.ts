import { test } from 'vitest'
import assert from 'node:assert'
import {
  uniqueNodeId,
  reservedIds,
  connectEdge,
  deleteNode,
  deleteEdge,
  updateNode,
  moveMany,
  makeLoopZone,
  copySubgraph,
  pasteSubgraph,
  applyOp,
  editorOps,
  NON_HISTORIC,
  type EditorGraph,
  type EditorOp,
  type EditorOpType,
  type Subgraph,
} from '../lib/editorOps'
import { withHistory } from '../lib/history'
import { ChainEdge, ChainNode } from '../lib/types'

test('uniqueNodeId increments until free', () => {
  assert.strictEqual(uniqueNodeId('agent', []), 'agent-1')
  assert.strictEqual(uniqueNodeId('agent', ['agent-1', 'agent-2']), 'agent-3')
})

test('makeLoopZone creates paired start/end sharing one zone id, unique ids', () => {
  const pair = makeLoopZone([], [100, 200])
  assert.strictEqual(pair.length, 2)
  assert.strictEqual(pair[0].kind, 'loop-start')
  assert.strictEqual(pair[1].kind, 'loop-end')
  assert.strictEqual(pair[0].zone, pair[1].zone)
  assert.notStrictEqual(pair[0].id, pair[1].id)
  assert.deepStrictEqual(pair[0].pos, [100, 200])
})

test('reservedIds spans node ids and distinct zone ids', () => {
  const zonedNodes: ChainNode[] = [
    { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
    { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
    { id: 'a', kind: 'agent', agent: 'x' },
  ]
  const reserved = reservedIds(zonedNodes)
  assert.ok(reserved.includes('loop-start-1') && reserved.includes('a'))
  assert.ok(reserved.includes('zone-1'))
  assert.strictEqual(reserved.filter(id => id === 'zone-1').length, 1)
})

test('copySubgraph and pasteSubgraph', () => {
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
  assert.strictEqual(clip.edges.length, 1)
  assert.strictEqual(clip.edges[0].fromNode, 'b')

  const pasted = pasteSubgraph(clip, ['b', 'c'], [40, 40])
  assert.strictEqual(pasted.nodes.length, 2)
  assert.ok(!pasted.newIds.includes('b') && !pasted.newIds.includes('c'))
  assert.ok(pasted.newIds.includes(pasted.edges[0].fromNode))
  assert.ok(pasted.newIds.includes(pasted.edges[0].toNode))
  const pb = pasted.nodes.find(n => n.kind === 'agent' && n.agent === 'x')!
  assert.deepStrictEqual(pb.pos, [50, 60])

  const loopClip: Subgraph = {
    nodes: [
      { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
      { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
    ],
    edges: [],
  }
  const loopPasted = pasteSubgraph(loopClip, ['loop-start-1', 'loop-end-1', 'zone-1'], [0, 0])
  assert.strictEqual(loopPasted.nodes[0].zone, loopPasted.nodes[1].zone)
  assert.notStrictEqual(loopPasted.nodes[0].zone, 'zone-1')

  const zonedNodes: ChainNode[] = [
    { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
    { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
    { id: 'a', kind: 'agent', agent: 'x' },
  ]
  const selfClip = copySubgraph(zonedNodes, [], ['loop-start-1', 'loop-end-1'])
  const selfPaste = pasteSubgraph(selfClip, reservedIds(zonedNodes), [40, 40])
  assert.notStrictEqual(selfPaste.nodes[0].zone, 'zone-1')
  assert.strictEqual(selfPaste.nodes[0].zone, selfPaste.nodes[1].zone)
})

test('deleteNode and deleteEdge functions', () => {
  const e1: ChainEdge = { fromNode: 'a', fromSocket: 'output', toNode: 'c', toSocket: 'input' }
  const e2: ChainEdge = { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'other' }
  const del = deleteNode(
    [{ id: 'a', kind: 'seed' }, { id: 'c', kind: 'agent', agent: 'x' }],
    [e1],
    'c',
  )
  assert.strictEqual(del.nodes.length, 1)
  assert.strictEqual(del.edges.length, 0)
  assert.strictEqual(deleteEdge([e1, e2], e1).length, 1)
})

test('updateNode and moveMany pure functions', () => {
  const nodes: ChainNode[] = [
    { id: 'a', kind: 'agent', agent: 'x', pos: [1, 1] },
    { id: 'b', kind: 'agent', agent: 'y', pos: [2, 2] },
  ]
  const updated = updateNode(nodes, 'a', { agent: 'z' })
  assert.strictEqual((updated[0] as Extract<ChainNode, { kind: 'agent' }>).agent, 'z')
  assert.strictEqual((nodes[0] as Extract<ChainNode, { kind: 'agent' }>).agent, 'x')

  const moved = moveMany(nodes, [{ id: 'a', pos: [10, 20] }, { id: 'b', pos: [30, 40] }])
  assert.deepStrictEqual(moved[0].pos, [10, 20])
  assert.deepStrictEqual(moved[1].pos, [30, 40])
  assert.deepStrictEqual(nodes[0].pos, [1, 1])
})

test('join/multi-input rule asserted against real nodes', () => {
  const nodes: ChainNode[] = [
    { id: 'a', kind: 'agent', agent: 'x' },
    { id: 'b', kind: 'agent', agent: 'y' },
    { id: 'c', kind: 'agent', agent: 'z' },
    { id: 'j', kind: 'join' },
  ]

  const e = (from: string, to: string, toSocket = 'input'): ChainEdge => ({
    fromNode: from,
    fromSocket: 'output',
    toNode: to,
    toSocket,
  })

  // Normal node (agent): 2nd edge replaces 1st into same socket; different socket kept
  const normalEdges = connectEdge(nodes, [e('a', 'c', 'input')], e('b', 'c', 'input'))
  assert.strictEqual(normalEdges.length, 1)
  assert.strictEqual(normalEdges[0].fromNode, 'b')
  const diffSocketEdges = connectEdge(nodes, normalEdges, e('a', 'c', 'other'))
  assert.strictEqual(diffSocketEdges.length, 2)

  // Join node (multiInput): keeps multiple edges to same socket, but dedups exact duplicate
  const joinEdges = connectEdge(nodes, [e('a', 'j', 'input')], e('b', 'j', 'input'))
  assert.strictEqual(joinEdges.length, 2)
  assert.deepStrictEqual(joinEdges.map(x => x.fromNode), ['a', 'b'])

  const dedupedJoinEdges = connectEdge(nodes, joinEdges, e('a', 'j', 'input'))
  assert.strictEqual(dedupedJoinEdges.length, 2)

  // Via editorOps.connect
  const g: EditorGraph = { nodes, edges: [e('a', 'j', 'input')], selectedIds: [], clipboard: null }
  const afterConnect = applyOp(g, editorOps.connect(e('b', 'j', 'input')))
  assert.strictEqual(afterConnect.edges.length, 2)
})

test('editorOps graph operations', () => {
  const base: EditorGraph = {
    nodes: [{ id: 'a', kind: 'seed' }, { id: 'b', kind: 'agent', agent: 'x' }],
    edges: [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' }],
    selectedIds: [],
    clipboard: null,
  }

  // setGraph
  const freshNodes: ChainNode[] = [{ id: 'n1', kind: 'seed' }]
  const freshEdges: ChainEdge[] = []
  const setG = applyOp(base, editorOps.setGraph(freshNodes, freshEdges))
  assert.strictEqual(setG.nodes, freshNodes)
  assert.strictEqual(setG.edges, freshEdges)

  // addNode appends, pure
  const added = applyOp(base, editorOps.addNode({ id: 'c', kind: 'gate' }))
  assert.strictEqual(added.nodes.length, 3)
  assert.strictEqual(base.nodes.length, 2)

  // deleteNode removes incident edges and deselects
  const sel: EditorGraph = { ...base, selectedIds: ['b'] }
  const del = applyOp(sel, editorOps.deleteNode('b'))
  assert.strictEqual(del.nodes.length, 1)
  assert.strictEqual(del.edges.length, 0)
  assert.deepStrictEqual(del.selectedIds, [])

  // deleteEdge removes specified edge
  const edgeToRemove = base.edges[0]
  const delE = applyOp(base, editorOps.deleteEdge(edgeToRemove))
  assert.strictEqual(delE.edges.length, 0)

  // moveNode
  const movedOne = applyOp(base, editorOps.moveNode('a', [10, 15]))
  assert.deepStrictEqual(movedOne.nodes.find(n => n.id === 'a')!.pos, [10, 15])

  // moveMany
  const movedMany = applyOp(base, editorOps.moveMany([{ id: 'a', pos: [5, 5] }, { id: 'b', pos: [9, 9] }]))
  assert.deepStrictEqual(movedMany.nodes.find(n => n.id === 'a')!.pos, [5, 5])
  assert.deepStrictEqual(movedMany.nodes.find(n => n.id === 'b')!.pos, [9, 9])

  // updateNode
  const updated = applyOp(base, editorOps.updateNode('b', { agent: 'y' }))
  assert.strictEqual((updated.nodes.find(n => n.id === 'b')! as Extract<ChainNode, { kind: 'agent' }>).agent, 'y')

  // setSelection referential identity guard
  const selA: EditorGraph = { ...base, selectedIds: ['a'] }
  assert.strictEqual(applyOp(selA, editorOps.setSelection(['a'])), selA)
  assert.notStrictEqual(applyOp(selA, editorOps.setSelection(['b'])), selA)

  // copy then paste duplicates with fresh ids
  const copied = applyOp({ ...base, selectedIds: ['a', 'b'] }, editorOps.copy(['a', 'b']))
  assert.ok(copied.clipboard && copied.clipboard.nodes.length === 2)
  const pasted = applyOp(copied, editorOps.paste())
  assert.strictEqual(pasted.nodes.length, 4)
  assert.strictEqual(pasted.selectedIds.length, 2)

  // paste when clipboard is null returns same graph
  assert.strictEqual(applyOp(base, editorOps.paste()), base)

  // addLoopZone mints zone id against reservedIds
  const oneLoop: EditorGraph = {
    nodes: [
      { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
      { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
    ],
    edges: [],
    selectedIds: [],
    clipboard: null,
  }
  const twoLoops = applyOp(oneLoop, editorOps.addLoopZone([120, 120]))
  const newZones = twoLoops.nodes.slice(2).map(n => n.zone)
  assert.ok(newZones.every(z => z && z !== 'zone-1'), 'second loop zone must not reuse zone-1')

  // paste copied loop back into its own graph must not reuse source zone
  const loopClip = applyOp({ ...oneLoop, selectedIds: ['loop-start-1', 'loop-end-1'] }, editorOps.copy(['loop-start-1', 'loop-end-1']))
  const loopPasted = applyOp(loopClip, editorOps.paste())
  const pastedZones = loopPasted.nodes.slice(2).map(n => n.zone)
  assert.ok(pastedZones.every(z => z && z !== 'zone-1'), 'pasted loop zone must be fresh, not zone-1')
})

test('undo/redo withHistory respects NON_HISTORIC and restores graph state', () => {
  const historied = withHistory(applyOp, (op: EditorOp) => !NON_HISTORIC.has(op.type))
  const initial: EditorGraph = {
    nodes: [{ id: 'a', kind: 'seed' }],
    edges: [],
    selectedIds: [],
    clipboard: null,
  }
  let h = { past: [] as EditorGraph[], present: initial, future: [] as EditorGraph[] }

  // Historic op: addNode
  h = historied(h, editorOps.addNode({ id: 'b', kind: 'agent', agent: 'x' }))
  assert.strictEqual(h.past.length, 1)
  assert.strictEqual(h.present.nodes.length, 2)
  assert.strictEqual(h.future.length, 0)

  // Non-historic op: setSelection
  h = historied(h, editorOps.setSelection(['b']))
  assert.strictEqual(h.past.length, 1, 'setSelection must not push history')
  assert.deepStrictEqual(h.present.selectedIds, ['b'])

  // Selection identity bail-out: same ids do not change history state
  const prevH = h
  h = historied(h, editorOps.setSelection(['b']))
  assert.strictEqual(h, prevH)

  // Non-historic op: copy
  h = historied(h, editorOps.copy(['b']))
  assert.strictEqual(h.past.length, 1, 'copy must not push history')
  assert.ok(h.present.clipboard)

  // Historic op: updateNode
  h = historied(h, editorOps.updateNode('b', { pos: [20, 30] }))
  assert.strictEqual(h.past.length, 2)
  assert.deepStrictEqual(h.present.nodes.find(n => n.id === 'b')!.pos, [20, 30])

  // Undo 1: undoes updateNode
  h = historied(h, editorOps.undo())
  assert.strictEqual(h.past.length, 1)
  assert.strictEqual(h.future.length, 1)
  assert.strictEqual(h.present.nodes.find(n => n.id === 'b')!.pos, undefined)

  // Undo 2: undoes addNode
  h = historied(h, editorOps.undo())
  assert.strictEqual(h.past.length, 0)
  assert.strictEqual(h.future.length, 2)
  assert.strictEqual(h.present.nodes.length, 1)

  // Undo past beginning: no-op
  const atStart = h
  h = historied(h, editorOps.undo())
  assert.strictEqual(h, atStart)

  // Redo 1: redoes addNode
  h = historied(h, editorOps.redo())
  assert.strictEqual(h.past.length, 1)
  assert.strictEqual(h.future.length, 1)
  assert.strictEqual(h.present.nodes.length, 2)

  // Redo 2: redoes updateNode
  h = historied(h, editorOps.redo())
  assert.strictEqual(h.past.length, 2)
  assert.strictEqual(h.future.length, 0)
  assert.deepStrictEqual(h.present.nodes.find(n => n.id === 'b')!.pos, [20, 30])

  // Redo at end: no-op
  const atEnd = h
  h = historied(h, editorOps.redo())
  assert.strictEqual(h, atEnd)

  // Non-historic op: setGraph replaces graph without pushing to past
  h = historied(h, editorOps.setGraph([{ id: 'g1', kind: 'seed' }], []))
  assert.strictEqual(h.past.length, 2, 'setGraph must not push history')
  assert.strictEqual(h.present.nodes[0].id, 'g1')
})
