import { test } from 'vitest'
import assert from 'node:assert'
import { readSocket } from '../lib/resolveNode'
import { ChainNode, AgentOutput } from '../lib/types'

test('resolve-loop', () => {
  function o(id: string, output: string): AgentOutput {
    return { nodeId: id, agentName: id, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
  }
  const outs = new Map<string, AgentOutput>([
    ['ls::draft', o('ls::draft', 'CURRENT DRAFT')],
    ['ls::feedback', o('ls::feedback', '')],
    ['le::draft', o('le::draft', 'FINAL DRAFT')],
  ])
  const read = (f: string) => `CTX:${f}`
  const ls: ChainNode = { id: 'ls', kind: 'loop-start', state: ['draft', 'feedback'] }
  const le: ChainNode = { id: 'le', kind: 'loop-end' }

  assert.strictEqual(readSocket(ls, 'draft', { outputs: outs, seedPrompt: 'SEED', readContext: read }).value, 'CURRENT DRAFT')
  assert.strictEqual(readSocket(ls, 'feedback', { outputs: outs, seedPrompt: 'SEED', readContext: read }).value, '')
  assert.strictEqual(readSocket(le, 'draft', { outputs: outs, seedPrompt: 'SEED', readContext: read }).value, 'FINAL DRAFT')
  assert.strictEqual(readSocket(ls, 'missing', { outputs: outs, seedPrompt: 'SEED', readContext: read }).value, '')
})
