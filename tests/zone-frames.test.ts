import assert from 'node:assert'
import { computeZoneFrames, PAD, NODE_W, NODE_H } from '../lib/zoneFrames'
import { ChainNode } from '../lib/types'

const nodes: ChainNode[] = [
  { id: 'ls', kind: 'loop-start', zone: 'z1', state: [], pos: [100, 100] },
  { id: 'mid', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 180] },
  { id: 'le', kind: 'loop-end', zone: 'z1', until: 'x', maxIterations: 2, pos: [500, 100] },
  { id: 'free', kind: 'seed', pos: [0, 0] }, // no zone -> ignored
]

const frames = computeZoneFrames(nodes)
assert.strictEqual(frames.length, 1)
const f = frames[0]
assert.strictEqual(f.zone, 'z1')
// minX=100, maxX=500+NODE_W ; box padded by PAD
assert.strictEqual(f.x, 100 - PAD)
assert.strictEqual(f.y, 100 - PAD)
assert.strictEqual(f.width, (500 + NODE_W - 100) + 2 * PAD)
assert.strictEqual(f.height, (180 + NODE_H - 100) + 2 * PAD)

// nodes without pos are ignored
assert.deepStrictEqual(computeZoneFrames([{ id: 'a', kind: 'loop-start', zone: 'z9', state: [] }]), [])

console.log('✅ zone-frames tests passed')
