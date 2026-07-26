import { test } from 'vitest'
import assert from 'node:assert'
import { readSocket } from '../lib/resolveNode'
import { ChainNode, AgentOutput } from '../lib/types'

test('resolve-control', () => {
  function out(nodeId: string, output: string): AgentOutput {
    return { nodeId, agentName: nodeId, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
  }
  const outs = new Map<string, AgentOutput>([
    ['a', out('a', 'AGENT BODY\n## Summary\nSHORT')],
    ['g', out('g', 'PASSED VALUE')],
    ['r', out('r', 'ROUTED VALUE')],
  ])
  const read = (f: string) => `CTX:${f}`

  const seed: ChainNode = { id: 's', kind: 'seed' }
  const ctx: ChainNode = { id: 'c', kind: 'context', file: 'lore' }
  const agent: ChainNode = { id: 'a', kind: 'agent', agent: 'a' }
  const gate: ChainNode = { id: 'g', kind: 'gate' }
  const branch: ChainNode = { id: 'r', kind: 'branch' }

  assert.strictEqual(readSocket(seed, 'output', outs, 'SEED', read).value, 'SEED')
  assert.strictEqual(readSocket(ctx, 'output', outs, 'SEED', read).value, 'CTX:lore')
  assert.strictEqual(readSocket(agent, 'output', outs, 'SEED', read).value, 'AGENT BODY\n## Summary\nSHORT')
  assert.strictEqual(readSocket(agent, 'summary', outs, 'SEED', read).value, 'SHORT')
  assert.strictEqual(readSocket(gate, 'output', outs, 'SEED', read).value, 'PASSED VALUE')
  assert.strictEqual(readSocket(branch, 'urgent', outs, 'SEED', read).value, 'ROUTED VALUE') // socket ignored
})
