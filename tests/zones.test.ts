import { test } from 'vitest'
import assert from 'node:assert'
import { pairedZones, zoneIssues, zoneFrames, zoneNames, adoptOnDrop, renameZone, PAD, NODE_W, NODE_H } from '../lib/zones'
import type { ChainEdge, ChainNode } from '../lib/types'

const edge = (fromNode: string, toNode: string, toSocket = 'in'): ChainEdge => ({ fromNode, fromSocket: 'output', toNode, toSocket })

const zoned = (): ChainNode[] => [
  { id: 'ls', kind: 'loop-start', zone: 'z1', state: ['draft', { name: 'notes', accumulate: true, separator: '\n' }], pos: [100, 100] },
  { id: 'b', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 180] },
  { id: 'a', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 100] },
  { id: 'le', kind: 'loop-end', zone: 'z1', until: '{b} done', maxIterations: 4, pos: [500, 100] },
  { id: 'free', kind: 'seed', pos: [0, 0] },
]

test('pairedZones pairs boundaries, parses state and orders the body by its edges', () => {
  const [z, ...rest] = pairedZones({ nodes: zoned(), edges: [edge('b', 'a')] })
  assert.strictEqual(rest.length, 0)
  assert.deepStrictEqual([z.id, z.startId, z.endId], ['z1', 'ls', 'le'])
  assert.deepStrictEqual(z.bodyIds, ['b', 'a'])
  assert.deepStrictEqual(z.bodyOrder, ['b', 'a'])
  assert.deepStrictEqual(pairedZones({ nodes: zoned(), edges: [edge('a', 'b')] })[0].bodyOrder, ['a', 'b'])
  assert.deepStrictEqual(z.states, [
    { name: 'draft', accumulate: false, separator: '\n\n' },
    { name: 'notes', accumulate: true, separator: '\n' },
  ])
  assert.strictEqual(z.until, '{b} done')
  assert.strictEqual(z.maxIterations, 4)
})

test('pairedZones skips a zone missing one boundary and ignores blank zone ids', () => {
  const nodes: ChainNode[] = [
    { id: 'ls', kind: 'loop-start', zone: 'lonely', state: [] },
    { id: 'p', kind: 'agent', agent: 'x', zone: '  ' },
  ]
  assert.deepStrictEqual(pairedZones({ nodes, edges: [] }), [])
  assert.deepStrictEqual(zoneNames(nodes), ['lonely'])
})

test('a body cycle drops its members from the order', () => {
  const z = pairedZones({ nodes: zoned(), edges: [edge('a', 'b'), edge('b', 'a')] })[0]
  assert.deepStrictEqual(z.bodyOrder, [])
})

test('zoneIssues names each way a zone is malformed', () => {
  const messages = (nodes: ChainNode[], edges: ChainEdge[] = []) => zoneIssues({ nodes, edges }).map(i => i.message)
  assert.deepStrictEqual(messages(zoned()), [])
  assert.ok(messages([{ id: 'ls', kind: 'loop-start', state: [] }]).some(m => /has no zone/.test(m)))
  assert.ok(messages([{ id: 'le', kind: 'loop-end', zone: 'z', until: 'x', maxIterations: 2 }]).some(m => /missing a paired loop-start/.test(m)))
  assert.ok(messages([{ id: 'a', kind: 'agent', agent: 'x', zone: 'z' }]).some(m => /needs exactly one loop-start/.test(m)))
  assert.ok(messages([{ id: 'ls', kind: 'loop-start', zone: 'z', state: [] }, { id: 'ls2', kind: 'loop-start', zone: 'z', state: [] }]).some(m => /duplicate loop-start "ls2"/.test(m)))
  const bad = zoned().map(n => n.kind === 'loop-end' ? { ...n, until: ' ', maxIterations: 1.5 } : n)
  assert.strictEqual(messages(bad).filter(m => /needs an "until"|positive integer/.test(m)).length, 2)
  const seedInside = [...zoned(), { id: 's', kind: 'seed', zone: 'z1' } as ChainNode]
  const hit = zoneIssues({ nodes: seedInside, edges: [] }).find(i => i.nodeId === 's')
  assert.ok(hit && hit.zone === 'z1' && /cannot sit inside loop zone/.test(hit.message))
})

test('zoneIssues flags an edge crossing a boundary except into loop-start or out of loop-end', () => {
  const crossing = (e: ChainEdge) => zoneIssues({ nodes: zoned(), edges: [e] }).filter(i => i.edge)
  assert.strictEqual(crossing(edge('free', 'a')).length, 1)
  assert.strictEqual(crossing(edge('a', 'free')).length, 1)
  assert.strictEqual(crossing(edge('free', 'ls', 'draft')).length, 0)
  assert.strictEqual(crossing(edge('le', 'free')).length, 0)
})

test('zoneFrames boxes positioned members with padding, ignoring unzoned and unplaced nodes', () => {
  const [f, ...rest] = zoneFrames(zoned())
  assert.strictEqual(rest.length, 0)
  assert.strictEqual(f.zone, 'z1')
  assert.strictEqual(f.x, 100 - PAD)
  assert.strictEqual(f.y, 100 - PAD)
  assert.strictEqual(f.width, (500 + NODE_W - 100) + 2 * PAD)
  assert.strictEqual(f.height, (180 + NODE_H - 100) + 2 * PAD)
  assert.deepStrictEqual(zoneFrames([{ id: 'a', kind: 'loop-start', zone: 'z9', state: [] }]), [])
})

test('adoptOnDrop: a body node joins the zone under its centre, or leaves', () => {
  const nodes: ChainNode[] = [...zoned(), { id: 'm', kind: 'agent', agent: 'x', pos: [2000, 2000] }]
  const inside: [number, number] = [310, 120]
  const outside: [number, number] = [1500, 1500]
  assert.deepStrictEqual(adoptOnDrop(nodes, 'm', inside), { pos: inside, zone: 'z1' })
  assert.deepStrictEqual(adoptOnDrop(nodes, 'm', outside), { pos: outside, zone: undefined })
  assert.strictEqual(adoptOnDrop(nodes, 'b', outside).zone, undefined, 'dragging a member out leaves the zone')
  assert.ok('zone' in adoptOnDrop(nodes, 'b', outside))
})

test('adoptOnDrop: the dragged node does not frame its own zone', () => {
  const nodes: ChainNode[] = [
    { id: 'ls', kind: 'loop-start', zone: 'z', state: [], pos: [0, 0] },
    { id: 'm', kind: 'agent', agent: 'x', zone: 'z', pos: [5000, 5000] },
  ]
  // with m counted, z's frame would stretch to cover (2000, 2000)
  assert.strictEqual(adoptOnDrop(nodes, 'm', [2000, 2000]).zone, undefined)
})

test('adoptOnDrop: a loop boundary does not adopt a zone', () => {
  const nodes: ChainNode[] = [
    ...zoned(),
    { id: 'ls2', kind: 'loop-start', zone: 'z2', state: [], pos: [3000, 3000] },
    { id: 'le2', kind: 'loop-end', zone: 'z2', until: 'x', maxIterations: 2, pos: [3400, 3000] },
  ]
  const patch = adoptOnDrop(nodes, 'ls2', [310, 120])
  assert.deepStrictEqual(patch, { pos: [310, 120] })
  assert.ok(!('zone' in patch))
  assert.deepStrictEqual(adoptOnDrop(nodes, 'nope', [1, 2]), { pos: [1, 2] })
})

test('renameZone renames every member and leaves others alone', () => {
  const renamed = renameZone(zoned(), 'z1', 'z-alpha')
  assert.deepStrictEqual(renamed.filter(n => n.zone === 'z-alpha').map(n => n.id), ['ls', 'b', 'a', 'le'])
  assert.strictEqual(renamed.find(n => n.id === 'free')?.zone, undefined)
  const nodes = zoned()
  assert.strictEqual(renameZone(nodes, 'z1', 'z1'), nodes)
})
