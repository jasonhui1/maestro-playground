import { test } from 'vitest'
import assert from 'node:assert'
import { appendTurn, chatSpeaker } from '../lib/nodeChat'
import { memoryRunFolders } from '../lib/runFolders'
import type { AgentDef, AgentOutput, ChainNode, RunMeta } from '../lib/types'

const record = (nodeId: string, output: string): AgentOutput => ({
  nodeId, agentName: nodeId, systemPrompt: 'sys', input: 'in', output,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'recorded', timestamp: '', status: 'success',
})

const agent: AgentDef = {
  slug: 'writer', name: 'writer', model: 'live', description: '', skills: [], context: [], input_from: 'user',
  output_format: 'markdown', outputs: [], inputs: [{ name: 'input' }], systemPrompt: '{input}', filePath: '',
}

// A complete run whose one node, `w`, was logged at step 2.
function run() {
  const runs = memoryRunFolders()
  const meta: RunMeta = {
    runId: 'r1', chainName: 'c', seedPrompt: 's', startedAt: '', status: 'complete',
    agentOutputs: [record('w', 'draft')],
    graph: { nodes: [{ id: 'w', kind: 'agent', agent: 'writer' } as ChainNode], edges: [] },
  }
  runs.create(meta)
  runs.writeStep('r1', 0, record('seed', ''))
  runs.writeStep('r1', 2, meta.agentOutputs[0])
  return runs
}

test('a node chat speaks as the model that wrote the output', () => {
  const runs = run()
  const speaker = chatSpeaker(runs, runs.read('r1'), 'w', [agent])
  assert.ok(!('error' in speaker))
  assert.strictEqual(speaker.agent.model, 'recorded')
})

test('a turn lands on the node\'s record and rewrites its latest log', () => {
  const runs = run()
  appendTurn(runs, 'r1', 'w', 'shorter?', { role: 'assistant', content: 'short' })

  assert.deepStrictEqual(runs.read('r1').agentOutputs[0].conversation, [
    { role: 'user', content: 'shorter?' }, { role: 'assistant', content: 'short' },
  ])
  const last = runs.logs('r1').at(-1)!
  assert.strictEqual(last.step, 2)
  assert.strictEqual(last.output.conversation?.length, 2)
})

test('a node with no log has no transcript to continue', () => {
  const runs = memoryRunFolders()
  runs.create(run().read('r1'))
  assert.deepStrictEqual(chatSpeaker(runs, runs.read('r1'), 'w', [agent]), { error: 'Node w has no log in this run', status: 400 })
})
