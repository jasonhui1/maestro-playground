import { test } from 'vitest'
import assert from 'node:assert'
import { socketValue } from '../lib/resolveNode'
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

  assert.strictEqual(socketValue(ls, 'draft', outs, 'SEED', read), 'CURRENT DRAFT')
  assert.strictEqual(socketValue(ls, 'feedback', outs, 'SEED', read), '')
  assert.strictEqual(socketValue(le, 'draft', outs, 'SEED', read), 'FINAL DRAFT')
  assert.strictEqual(socketValue(ls, 'missing', outs, 'SEED', read), '')
})
