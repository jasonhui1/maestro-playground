import assert from 'node:assert'
import { resolveRunChain } from '../lib/resolveRunChain'
import { AgentDef, ChainDef } from '../lib/types'

const chains: ChainDef[] = [{
  slug: 'triage', name: 'Triage', description: '', filePath: '/w/chains/triage.md',
  nodes: [{ id: 'seed', kind: 'seed' }], edges: [],
}]
const agents = [{ slug: 'writer', name: 'Writer', systemPrompt: 'hi' } as AgentDef]

// inline graph is used verbatim, kind 'inline', no filePath
const inline = resolveRunChain({ chain: { name: 'Live', nodes: [{ id: 'seed', kind: 'seed' }], edges: [] }, slug: 'triage' }, { agents, chains })
assert.ok('chain' in inline)
if ('chain' in inline) {
  assert.strictEqual(inline.kind, 'inline')
  assert.strictEqual(inline.chain.filePath, '')
  assert.strictEqual(inline.chain.nodes.length, 1)
}

// chainName resolves from the workspace by name or slug
const byName = resolveRunChain({ chainName: 'Triage' }, { agents, chains })
assert.ok('chain' in byName && byName.kind === 'chain' && byName.chain.slug === 'triage')

// unknown chainName -> error 404
const missing = resolveRunChain({ chainName: 'nope' }, { agents, chains })
assert.ok('error' in missing && missing.status === 404)

// agentName synthesizes a seed -> agent chain
const ag = resolveRunChain({ agentName: 'writer' }, { agents, chains })
assert.ok('chain' in ag && ag.kind === 'agent')
if ('chain' in ag) {
  assert.strictEqual(ag.chain.nodes.length, 2)
  assert.strictEqual(ag.chain.edges[0].toNode, 'writer')
}

// nothing -> error 400
const none = resolveRunChain({}, { agents, chains })
assert.ok('error' in none && none.status === 400)

console.log('✅ resolve-run-chain tests passed')
