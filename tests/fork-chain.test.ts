import assert from 'node:assert'
import { buildChainFromTemplate } from '../lib/fs/forkChain'
import { ChainDef, TemplateDef } from '../lib/types'

const refChain: ChainDef = {
  slug: 'triage', name: 'Triage', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'a', kind: 'agent', agent: 'x' }],
  edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'a', toSocket: 'input' }],
}
const tmpl: TemplateDef = { slug: 't1', name: 'My Template', description: '', chain: 'triage', seedPrompt: 'go', filePath: '' }

// copies the referenced chain's graph, derives a kebab slug from the new name
const forked = buildChainFromTemplate(tmpl, 'New Flow', [refChain])
assert.strictEqual(forked.slug, 'new-flow')
assert.strictEqual(forked.nodes.length, 2)
assert.strictEqual(forked.edges.length, 1)
assert.strictEqual(forked.nodes[1].agent, 'x')

// the copy is independent of the source chain
forked.nodes[0].id = 'changed'
assert.strictEqual(refChain.nodes[0].id, 'seed')

// empty/missing ref -> empty graph + fallback description
const blank = buildChainFromTemplate({ ...tmpl, chain: '' }, 'Blank', [refChain])
assert.strictEqual(blank.nodes.length, 0)
assert.strictEqual(blank.edges.length, 0)
assert.match(blank.description, /A new chain named Blank/)

console.log('✅ fork-chain tests passed')
