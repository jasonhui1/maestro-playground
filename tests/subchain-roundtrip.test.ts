import assert from 'node:assert'
import { serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'
import { ChainNode, ChainEdge } from '../lib/types'

const nodes: ChainNode[] = [
  { id: 'seedA', kind: 'seed', pos: [0, 0] },
  { id: 'sub', kind: 'subchain', subchain: 'triage', pos: [200, 0] },
]
const edges: ChainEdge[] = [{ fromNode: 'seedA', fromSocket: 'output', toNode: 'sub', toSocket: 'topic' }]

const raw = serializeChain(
  { name: 'Has Subchain', description: '', inputs: [{ name: 'topic', node: 'seedA' }], outputs: [{ name: 'verdict', node: 'w', socket: 'output' }] },
  nodes, edges,
)
const parsed = parseChainContent(raw, 'has-subchain')

const sub = parsed.nodes.find(n => n.id === 'sub')!
assert.strictEqual(sub.kind, 'subchain')
assert.strictEqual(sub.subchain, 'triage')
assert.deepStrictEqual(parsed.inputs, [{ name: 'topic', node: 'seedA' }])
assert.strictEqual(parsed.outputs![0].name, 'verdict')
assert.strictEqual(parsed.outputs![0].node, 'w')

console.log('✅ subchain-roundtrip tests passed')
