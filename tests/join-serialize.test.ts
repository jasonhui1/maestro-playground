// tests/join-serialize.test.ts
import assert from 'node:assert'
import { chainToData } from '../lib/serializeChain'
import { ChainNode, ChainEdge } from '../lib/types'

const nodes: ChainNode[] = [{ id: 'j', kind: 'join', pos: [10, 20] }]
const data = chainToData({ name: 'c' }, nodes, [] as ChainEdge[]) as { nodes: Record<string, unknown>[] }
assert.deepStrictEqual(data.nodes[0], { id: 'j', kind: 'join', pos: [10, 20] },
  'join serializes with no stray fields')
console.log('✅ join serialize tests passed')
