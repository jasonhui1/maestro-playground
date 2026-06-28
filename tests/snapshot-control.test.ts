import assert from 'node:assert'
import { buildRunGraphFromSnapshot } from '../lib/graph'
import { RunMeta, AgentOutput } from '../lib/types'

function o(nodeId: string, agentName: string, status: AgentOutput['status']): AgentOutput {
  return { nodeId, agentName, systemPrompt: '', input: '', output: '', tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status }
}
const run: RunMeta = {
  runId: 'r', chainName: 'c', seedPrompt: 's', startedAt: '', status: 'complete',
  agentOutputs: [o('p', 'p', 'success'), o('g', 'gate: BLOCK', 'success'), o('f', 'gate', 'skipped')],
  graph: {
    nodes: [
      { id: 'p', kind: 'agent', agent: 'p' },
      { id: 'g', kind: 'gate' },
      { id: 'f', kind: 'agent', agent: 'f' },
    ],
    edges: [
      { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
      { fromNode: 'g', fromSocket: 'output', toNode: 'f', toSocket: 'in' },
    ],
  },
}
const tg = buildRunGraphFromSnapshot(run)
const g = tg.nodes.find(n => n.id === 'g')!
assert.strictEqual(g.label, 'gate', 'gate node labelled by kind')
const f = tg.nodes.find(n => n.id === 'f')!
assert.strictEqual(f.status, 'skipped', 'skipped status carried through')
console.log('✅ snapshot-control tests passed')
