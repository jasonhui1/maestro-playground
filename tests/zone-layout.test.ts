import { test } from 'vitest'
import assert from 'node:assert'
import { zoneFrames, adoptOnDrop, PAD, NODE_W, NODE_H } from '../lib/zoneLayout'
import type { ChainNode } from '../lib/types'

const zoned = (): ChainNode[] => [
  { id: 'ls', kind: 'loop-start', zone: 'z1', state: [], pos: [100, 100] },
  { id: 'b', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 180] },
  { id: 'a', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 100] },
  { id: 'le', kind: 'loop-end', zone: 'z1', until: '{b} done', maxIterations: 4, pos: [500, 100] },
  { id: 'free', kind: 'seed', pos: [0, 0] },
]

test('zoneFrames boxes positioned members with padding, ignoring unzoned and unplaced nodes', () => {
  const [f, ...rest] = zoneFrames(zoned())
  assert.strictEqual(rest.length, 0)
  assert.strictEqual(f.id, 'z1')
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
