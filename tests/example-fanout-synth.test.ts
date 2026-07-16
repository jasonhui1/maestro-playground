// tests/example-fanout-synth.test.ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, name: string, prompt: string): AgentDef => ({
  slug, name, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [
  agent('optimist',    'Optimist',    'You are the Optimist. Argue FOR:\n{brief}'),
  agent('skeptic',     'Skeptic',     'You are the Skeptic. Argue AGAINST:\n{brief}'),
  agent('pragmatist',  'Pragmatist',  'You are the Pragmatist. Give the trade-off:\n{brief}'),
  agent('synthesizer', 'Synthesizer', 'Reconcile this panel into one call:\n\n{panel}'),
]
const chain: ChainDef = {
  slug: 'fanout-synth', name: 'Fan-out + synthesis', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'w1', kind: 'agent', agent: 'optimist' },
    { id: 'w2', kind: 'agent', agent: 'skeptic' },
    { id: 'w3', kind: 'agent', agent: 'pragmatist' },
    { id: 'j',  kind: 'join' },
    { id: 'syn', kind: 'agent', agent: 'synthesizer' },
    { id: 'rep', kind: 'report' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w1', toSocket: 'brief' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w2', toSocket: 'brief' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w3', toSocket: 'brief' },
    { fromNode: 'w1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'w2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'w3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'j', fromSocket: 'output', toNode: 'syn', toSocket: 'panel' },
    { fromNode: 'syn', fromSocket: 'output', toNode: 'rep', toSocket: 'in' },
  ],
}
const noop = { onStart() {}, onToken() {}, onDone() {} }
const slow = (async (a: AgentDef, sys: string) => {
  await new Promise(r => setTimeout(r, 50))
  return { agentName: a.name, systemPrompt: sys, input: '', output: `[${a.name} on: ${sys.split('\n').pop()}]`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

async function main() {
  assert.ok(validateChain(chain, agents).valid, 'example chain validates')

  const t = Date.now()
  const results = await runChainGraph(chain, agents, [], 'Should we ship on Friday?', '/ws', noop, slow)
  const elapsed = Date.now() - t

  // A: the three-voice panel ran concurrently (~50ms, not ~150ms)
  assert.ok(elapsed < 130, `panel should run concurrently; got ${elapsed}ms`)

  // B: the join merged all three, labeled, in edge order
  const j = results.find(r => r.nodeId === 'j')!
  assert.ok(j.output.indexOf('## Optimist') < j.output.indexOf('## Skeptic')
         && j.output.indexOf('## Skeptic') < j.output.indexOf('## Pragmatist'), 'panel labeled + ordered')

  // synthesis saw the whole panel; report carries the synthesis
  const syn = results.find(r => r.nodeId === 'syn')!
  assert.ok(syn.systemPrompt.includes('## Optimist') && syn.systemPrompt.includes('## Pragmatist'),
    'synthesizer received the merged panel')
  const rep = results.find(r => r.nodeId === 'rep')!
  assert.ok(rep.output.includes('Synthesizer'), 'report passes the synthesis through')

  // determinism invariant
  assert.deepStrictEqual(results.map(r => r.nodeId), ['w1', 'w2', 'w3', 'j', 'syn', 'rep'],
    'results in topo order')

  console.log(`✅ fan-out → join → synthesize passed (${elapsed}ms)`)
}
main().catch(err => { console.error(err); process.exit(1) })
