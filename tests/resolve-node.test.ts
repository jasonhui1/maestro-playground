import assert from 'node:assert'
import { resolveNodePrompt } from '../lib/resolveNode'
import { ChainDef, AgentDef, AgentOutput, ChainNode } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }, { name: 'summary' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
function out(nodeId: string, agentName: string, output: string): AgentOutput {
  return { nodeId, agentName, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'lore', kind: 'context', file: 'world-lore' },
    { id: 'wb', kind: 'agent', agent: 'world-builder' },
    { id: 'cd', kind: 'agent', agent: 'character-designer' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
    { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
    { fromNode: 'lore', fromSocket: 'output', toNode: 'cd', toSocket: 'lore' },
  ],
}
const nodeOutputs = new Map<string, AgentOutput>([
  ['wb', out('wb', 'world-builder', 'Full text.\n## Summary\nshort world')],
])
const readContext = (f: string) => f === 'world-lore' ? 'LORE TEXT' : '[missing]'

// seed source
const wbNode = chain.nodes.find(n => n.id === 'wb') as ChainNode
assert.strictEqual(
  resolveNodePrompt(wbNode, chain, agent('world-builder', 'Seed: {input}'), nodeOutputs, 'MY SEED', readContext),
  'Seed: MY SEED'
)
// agent .summary source + context source
const cdNode = chain.nodes.find(n => n.id === 'cd') as ChainNode
assert.strictEqual(
  resolveNodePrompt(cdNode, chain, agent('character-designer', 'World: {world}\nLore: {lore}'), nodeOutputs, 'MY SEED', readContext),
  'World: short world\nLore: LORE TEXT'
)
// unwired slot
assert.strictEqual(
  resolveNodePrompt(cdNode, chain, agent('character-designer', 'X: {missing}'), nodeOutputs, 'MY SEED', readContext),
  'X: [missing: not wired]'
)
console.log('✅ resolveNodePrompt tests passed')
