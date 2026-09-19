import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { continueRun } from '../lib/continueRun'
import { parseChainContent } from '../lib/parseChain'
import type { LiveWorkspace } from '../lib/runSession'
import { memoryWorkspace } from '../lib/runFolders'
import type { AgentDef, AgentOutput, RunMeta } from '../lib/types'

// No workspace on disk: the run folders and version snapshots are in memory, the model is a stub.
vi.mock('@/lib/logger', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/logger')>(),
  newRunId: () => 'fork-1',
}))

vi.mock('@/lib/fs/versions', () => ({ snapshotVersion: () => 1 }))

vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: AgentDef, systemPrompt: string, input: string): Promise<AgentOutput> => ({
    agentName: agent.name, systemPrompt, input,
    output: agent.slug === 'decider' ? '## Candidate 1\nan idea' : `from ${agent.slug}`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }),
}))

const chain = parseChainContent(`---
name: held
nodes:
  - id: seed
    kind: seed
  - id: prop
    kind: agent
    agent: prop
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: prop.input
  - from: prop
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`, 'held')

const agent = (slug: string, inputs: string[]): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [], input_from: 'user',
  output_format: 'markdown', outputs: [], inputs: inputs.map(name => ({ name })),
  systemPrompt: `{${inputs[0]}}`, filePath: '',
})

const defs = {
  agents: [agent('prop', ['input']), agent('decider', ['input']), agent('after', ['direction'])],
  skills: [], chains: [], tools: [], templates: [], context: [], defaults: {},
} as unknown as LiveWorkspace

function record(nodeId: string, output: string, extra: Partial<AgentOutput> = {}): AgentOutput {
  return {
    nodeId, agentName: nodeId, systemPrompt: '', input: 'in', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...extra,
  }
}

let ws = memoryWorkspace()

// A run paused at its hold: prop and dec logged as steps 0 and 1.
function waitingRun(status: RunMeta['status'] = 'waiting'): string {
  const meta: RunMeta = {
    runId: 'run-1', chainName: 'held', seedPrompt: 'go', startedAt: '', status,
    agentOutputs: [
      record('prop', 'first', { conversation: [{ role: 'user', content: 'better?' }, { role: 'assistant', content: 'second' }] }),
      record('dec', '## Candidate 1\nold', {
        conversation: [{ role: 'user', content: 'another?' }, { role: 'assistant', content: '## Candidate 1\nnew' }],
      }),
    ],
    holds: [{ nodeId: 'hold', input: '## Candidate 1\nold', candidates: [], reachedAt: 't0' }],
    graph: { nodes: chain.nodes, edges: chain.edges },
  }
  ws.runs.create(meta)
  ws.runs.writeStep('run-1', 0, meta.agentOutputs[0])
  ws.runs.writeStep('run-1', 1, meta.agentOutputs[1])
  return meta.runId
}

beforeEach(() => { ws = memoryWorkspace() })

const drain = async (res: Response) => { await res.text() }
const logsOf = (runId: string) => ws.runs.logs(runId).map(({ step, output }) => ({ runId, step, nodeId: output.nodeId, output: output.output }))
const newLogs = () => logsOf('run-1').slice(2)

test('an answer in place logs the answer and what follows it, numbered after the last log', async () => {
  const runId = waitingRun()
  const res = continueRun(ws, defs, runId, { answer: { direction: 'go on' } })
  assert.equal(res.status, 200)
  await drain(res)

  assert.deepStrictEqual(newLogs(), [
    { runId: 'run-1', step: 2, nodeId: 'hold', output: 'go on' },
    { runId: 'run-1', step: 3, nodeId: 'after', output: 'from after' },
  ])
  const after = ws.runs.read('run-1')
  assert.equal(after.status, 'complete')
  assert.deepStrictEqual(after.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'hold', 'after'])
})

test('a promote in place relogs its source and numbers the rerun after the last log', async () => {
  const runId = waitingRun()
  const res = continueRun(ws, defs, runId, { promote: { nodeId: 'prop' } })
  assert.equal(res.status, 200)
  await drain(res)

  // The source log is rewritten with its flag; the revision and its descendants follow step 1.
  assert.deepStrictEqual(newLogs(), [
    { runId: 'run-1', step: 0, nodeId: 'prop', output: 'first' },
    { runId: 'run-1', step: 2, nodeId: 'prop', output: 'second' },
    { runId: 'run-1', step: 3, nodeId: 'dec', output: '## Candidate 1\nan idea' },
  ])
  const after = ws.runs.read('run-1')
  assert.equal(after.status, 'waiting')
  assert.deepStrictEqual(after.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'prop', 'dec'])
})

test('a record kept by a promote is the one on disk: not logged again, not recorded twice', async () => {
  const runId = waitingRun()
  const res = continueRun(ws, defs, runId, { promote: { nodeId: 'dec' } })
  assert.equal(res.status, 200)
  await drain(res)

  assert.deepStrictEqual(newLogs().map(l => [l.step, l.nodeId]), [[1, 'dec'], [2, 'dec']])
  const after = ws.runs.read('run-1')
  assert.deepStrictEqual(after.agentOutputs.map(o => [o.nodeId, o.output]), [
    ['prop', 'first'], ['dec', '## Candidate 1\nold'], ['dec', '## Candidate 1\nnew'],
  ])
})

test('a fork logs every replayed record afresh in a new run, from step 0', async () => {
  const runId = waitingRun('complete')
  const res = continueRun(ws, defs, runId, { fork: { from: 'dec' } })
  assert.equal(res.status, 200)
  await drain(res)

  assert.deepStrictEqual(newLogs(), [])
  assert.deepStrictEqual(logsOf('fork-1').map(l => [l.runId, l.step, l.nodeId]), [
    ['fork-1', 0, 'prop'],
    ['fork-1', 1, 'dec'],
  ])
  assert.equal(ws.runs.read('fork-1').branchedFromRunId, 'run-1')
})

test('a running run is refused before any plan is read', async () => {
  const runId = waitingRun('running')
  const res = continueRun(ws, defs, runId, { answer: { direction: 'go on' } })
  assert.equal(res.status, 409)
  assert.deepStrictEqual(newLogs(), [])
})

test('an unknown run is refused', async () => {
  assert.equal(continueRun(ws, defs, 'no-such-run', { answer: { direction: 'go on' } }).status, 404)
})

test('a run claimed by another continuation after it was read is refused at the claim', async () => {
  const runId = waitingRun()
  const runs = ws.runs
  let rival = false
  const racing = {
    ...ws,
    runs: {
      ...runs,
      read: (id: string) => {
        const meta = runs.read(id)
        rival = runs.claim(id, {})
        return meta
      },
    },
  }
  const res = continueRun(racing, defs, runId, { answer: { direction: 'go on' } })
  assert.ok(rival)
  assert.equal(res.status, 409)
  assert.deepStrictEqual(newLogs(), [])
  assert.deepStrictEqual(ws.runs.read(runId).agentOutputs.map(o => o.nodeId), ['prop', 'dec'])
})
