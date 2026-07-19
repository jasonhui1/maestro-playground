import assert from 'node:assert'
import { kindOf } from '../lib/nodeKinds'
import type { ChainDef, ChainNode } from '../lib/types'

const chain: ChainDef = { slug: 'c', name: 'c', description: '', nodes: [], edges: [], filePath: '' }
const report: ChainNode = { id: 'r1', kind: 'report' }
const workspace = { chain, agents: [], chains: [] }

assert.deepStrictEqual(kindOf('report').inputs(report, workspace).map(s => s.name), ['in'])
assert.deepStrictEqual(kindOf('report').outputs(report, workspace), [])
console.log('✅ report sockets tests passed')
