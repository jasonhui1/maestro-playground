import assert from 'node:assert'
import { buildRunGraphFromSnapshot } from '../lib/graph'
import { RunMeta, AgentOutput } from '../lib/types'

function out(nodeId: string, agentName: string, output: string): AgentOutput {
  return { nodeId, agentName, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}
const run: RunMeta = {
  runId: 'r', chainName: 'c', seedPrompt: 's', startedAt: '', status: 'complete',
  agentOutputs: [out('wb', 'world-builder', 'x'), out('cd', 'character-designer', 'y')],
  graph: {
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'wb', kind: 'agent', agent: 'world-builder' },
      { id: 'cd', kind: 'agent', agent: 'character-designer' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
      { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
    ],
  },
}
const g = buildRunGraphFromSnapshot(run)
assert.strictEqual(g.nodes.length, 3)
const cd = g.nodes.find(n => n.id === 'cd')!
assert.strictEqual(cd.kind, 'agent')
assert.strictEqual(cd.stepIndex, 1)
assert.strictEqual(cd.inputs!.length, 1)
assert.strictEqual(cd.inputs![0].id, 'world')           // input handle id = toSocket
const wb = g.nodes.find(n => n.id === 'wb')!
assert.ok(wb.outputs!.some(o => o.id === 'summary'), 'summary output socket present')
assert.ok(g.edges.some(e => e.source === 'wb' && e.sourceHandle === 'summary' && e.target === 'cd' && e.targetHandle === 'world'))
console.log('✅ buildRunGraphFromSnapshot tests passed')
