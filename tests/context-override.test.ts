import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import type { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}

function chain(): ChainDef {
  return {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'canon', kind: 'context', file: 'canon-test' },
      { id: 'writer', kind: 'agent', agent: 'writer' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'writer', toSocket: 'seed' },
      { fromNode: 'canon', fromSocket: 'output', toNode: 'writer', toSocket: 'canon' },
    ],
  }
}

const stubRun = (async (a: AgentDef, sys: string) => ({
  agentName: a.name, systemPrompt: sys, input: '', output: 'done',
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
}) as AgentOutput) as never
const noop = { onStart() {}, onToken() {}, onDone() {} }

test('a request-supplied context value wins over the workspace file', async () => {
  const agents = [agent('writer', 'Canon: {canon}')]
  const results = await runChainGraph(
    chain(), agents, [], 'go', '/nonexistent', noop, stubRun, [], [], [], 0, '',
    { 'canon-test': 'INLINE CANON TEXT' },
  )
  const writer = results.find(r => r.agentName === 'writer')!
  assert.ok(writer.systemPrompt.includes('INLINE CANON TEXT'))
})

test('falls back to the not-found placeholder when neither override nor file exists', async () => {
  const agents = [agent('writer', 'Canon: {canon}')]
  const results = await runChainGraph(
    chain(), agents, [], 'go', '/nonexistent', noop, stubRun, [], [], [], 0, '', {},
  )
  const writer = results.find(r => r.agentName === 'writer')!
  assert.ok(writer.systemPrompt.includes('[context canon-test not found]'))
})
