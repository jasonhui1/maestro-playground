import assert from 'node:assert'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { ChainDef, ChainNode } from '../lib/types'

const ref: ChainDef = {
  slug: 'triage', name: 'Triage', description: '', filePath: '',
  nodes: [{ id: 'seedA', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'x' }],
  edges: [],
  inputs: [{ name: 'topic', node: 'seedA' }],
  outputs: [{ name: 'verdict', node: 'w' }, { name: 'summary', node: 'w', socket: 'summary' }],
}
const host: ChainDef = { slug: 'host', name: 'Host', description: '', filePath: '', nodes: [], edges: [] }
const sub: ChainNode = { id: 'sub', kind: 'subchain', subchain: 'triage' }

assert.deepStrictEqual(inputSocketsOf(sub, host, [], [ref]), ['topic'])
assert.deepStrictEqual(outputSocketsOf(sub, host, [], [ref]), ['verdict', 'summary'])

// fallback when the referenced chain declares nothing
const bare: ChainDef = { slug: 'bare', name: 'Bare', description: '', filePath: '', nodes: [], edges: [] }
const sub2: ChainNode = { id: 's2', kind: 'subchain', subchain: 'bare' }
assert.deepStrictEqual(inputSocketsOf(sub2, host, [], [bare]), [])
assert.deepStrictEqual(outputSocketsOf(sub2, host, [], [bare]), ['output'])

console.log('✅ nodesockets-subchain tests passed')
