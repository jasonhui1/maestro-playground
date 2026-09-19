import { test } from 'vitest'
import assert from 'node:assert'
import { chainToData } from '../lib/serializeChain'
import { ChainDef, ChainNode } from '../lib/types'

test('join serializes with no stray fields', () => {
  const nodes: ChainNode[] = [{ id: 'j', kind: 'join', pos: [10, 20] }]
  const chain: ChainDef = { slug: 'c', name: 'c', description: '', filePath: '', nodes, edges: [] }
  const data = chainToData(chain) as { nodes: Record<string, unknown>[] }
  assert.deepStrictEqual(data.nodes[0], { id: 'j', kind: 'join', pos: [10, 20] })
})
