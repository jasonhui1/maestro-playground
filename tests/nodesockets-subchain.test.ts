import assert from 'node:assert'
import { kindOf } from '../lib/nodeKinds'
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

assert.deepStrictEqual(kindOf('subchain').inputs(sub, { chain: host, agents: [], chains: [ref] }).map(s => s.name), ['topic'])
assert.deepStrictEqual(kindOf('subchain').outputs(sub, { chain: host, agents: [], chains: [ref] }), ['verdict', 'summary'])

// fallback when the referenced chain declares nothing
const bare: ChainDef = { slug: 'bare', name: 'Bare', description: '', filePath: '', nodes: [], edges: [] }
const sub2: ChainNode = { id: 's2', kind: 'subchain', subchain: 'bare' }
assert.deepStrictEqual(kindOf('subchain').inputs(sub2, { chain: host, agents: [], chains: [bare] }), [])
assert.deepStrictEqual(kindOf('subchain').outputs(sub2, { chain: host, agents: [], chains: [bare] }), ['output'])

console.log('✅ nodesockets-subchain tests passed')
