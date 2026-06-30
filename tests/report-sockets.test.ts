import assert from 'node:assert'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import type { ChainDef, ChainNode } from '../lib/types'

const chain: ChainDef = { slug: 'c', name: 'c', description: '', nodes: [], edges: [], filePath: '' }
const report: ChainNode = { id: 'r1', kind: 'report' }

assert.deepStrictEqual(inputSocketsOf(report, chain, [], []), ['in'])
assert.deepStrictEqual(outputSocketsOf(report, chain, [], []), [])
console.log('✅ report sockets tests passed')
