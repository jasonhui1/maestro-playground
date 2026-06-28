import assert from 'node:assert'
import { topoOrder, validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, OutputSocketDef } from '../lib/types'

function agent(slug: string, prompt: string, outputs: OutputSocketDef[] = [{ name: 'output' }]): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs, inputs: [], systemPrompt: prompt, filePath: `${slug}.md` }
}
function chain(nodes: ChainDef['nodes'], edges: ChainDef['edges']): ChainDef {
  return { slug: 'c', name: 'c', description: '', nodes, edges, filePath: '' }
}

const agents = [
  agent('world-builder', 'Seed: {input}', [{ name: 'output' }, { name: 'summary' }]),
  agent('character-designer', 'World: {world}', [{ name: 'output' }, { name: 'summary' }]),
]

// valid diamond-ish chain
const good = chain(
  [
    { id: 'seed', kind: 'seed' },
    { id: 'wb', kind: 'agent', agent: 'world-builder' },
    { id: 'cd', kind: 'agent', agent: 'character-designer' },
  ],
  [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
    { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
  ],
)
assert.deepStrictEqual(validateChain(good, agents).valid, true)
const order = topoOrder(good)
assert.ok(order.indexOf('wb') < order.indexOf('cd'), 'wb before cd')
assert.ok(order.indexOf('seed') < order.indexOf('wb'), 'seed before wb')

// dangling edge (unknown source node)
const dangling = chain(good.nodes, [...good.edges, { fromNode: 'ghost', fromSocket: 'output', toNode: 'cd', toSocket: 'world' }])
assert.strictEqual(validateChain(dangling, agents).valid, false)

// fan-in: two edges into cd.world
const fanin = chain(good.nodes, [
  { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
  { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
  { fromNode: 'seed', fromSocket: 'output', toNode: 'cd', toSocket: 'world' },
])
assert.ok(validateChain(fanin, agents).errors.some(e => /one allowed|incoming/i.test(e)), 'fan-in flagged')

// undeclared output socket (.characters not declared on world-builder)
const badSock = chain(good.nodes, [
  { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
  { fromNode: 'wb', fromSocket: 'characters', toNode: 'cd', toSocket: 'world' },
])
assert.ok(validateChain(badSock, agents).errors.some(e => /output socket/i.test(e)), 'undeclared output flagged')

// cycle
const cyc = chain(
  [{ id: 'a', kind: 'agent', agent: 'character-designer' }, { id: 'b', kind: 'agent', agent: 'character-designer' }],
  [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'world' },
   { fromNode: 'b', fromSocket: 'output', toNode: 'a', toSocket: 'world' }],
)
assert.strictEqual(topoOrder(cyc).length < cyc.nodes.length, true)
assert.ok(validateChain(cyc, agents).errors.some(e => /cycle/i.test(e)), 'cycle flagged')

// duplicate node IDs
const dup = chain(
  [
    { id: 'wb', kind: 'agent', agent: 'world-builder' },
    { id: 'wb', kind: 'agent', agent: 'world-builder' },
  ],
  []
)
assert.strictEqual(validateChain(dup, agents).valid, false)
assert.ok(validateChain(dup, agents).errors.some(e => /duplicate/i.test(e)), 'duplicate node ID flagged')

// invalid node kind
const invalidKind = chain(
  [
    { id: 'wb', kind: 'invalid-kind' as any, agent: 'world-builder' },
  ],
  []
)
assert.strictEqual(validateChain(invalidKind, agents).valid, false)
assert.ok(validateChain(invalidKind, agents).errors.some(e => /invalid or missing kind/i.test(e)), 'invalid kind flagged')

console.log('✅ chainGraph tests passed')
