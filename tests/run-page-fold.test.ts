import { test } from 'vitest'
import assert from 'node:assert'
// Wire bytes → streamRun → reducer + order, the exact path app/run/page.tsx now takes (#33).
import { streamRun, RunEvent } from '../lib/runStream'
import { applyInstanceEvent, applyInstanceOrder, orderFor, InstanceRunMap, InstanceOrder } from '../lib/runModel'
import { AgentOutput } from '../lib/types'

function frame(e: unknown): string {
  return `data: ${JSON.stringify(e)}\n\n`
}

function readerOf(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s))
      c.close()
    },
  }).getReader()
}

function done(o: Partial<AgentOutput>): AgentOutput {
  return {
    agentName: 'x', systemPrompt: 'sys', input: '', output: '', tokensIn: 10, tokensOut: 5,
    costUsd: 0.001, latencyMs: 200, model: 'm', timestamp: '', status: 'success', ...o,
  }
}

// seed → draft(n1) → loop[ patch(n2) ]×3 → report(n3, errors)
function tape(): string[] {
  const out: string[] = []
  out.push(frame({ type: 'agent_start', nodeId: 'n1', agentName: 'draft', step: 0 }))
  out.push(frame({ type: 'token', nodeId: 'n1', agentName: 'draft', token: 'dr', step: 0 }))
  out.push(frame({ type: 'token', nodeId: 'n1', agentName: 'draft', token: 'aft', step: 0 }))
  out.push(frame({ type: 'agent_done', nodeId: 'n1', agentName: 'draft', step: 0, output: done({ agentName: 'draft', output: 'draft' }) }))

  for (let round = 0; round < 3; round++) {
    const step = round + 1
    out.push(frame({ type: 'agent_start', nodeId: 'n2', agentName: 'patch', step }))
    out.push(frame({ type: 'token', nodeId: 'n2', agentName: 'patch', token: `think${round}`, tokenType: 'thought', step }))
    out.push(frame({ type: 'token', nodeId: 'n2', agentName: 'patch', token: `v${round}`, step }))
    out.push(frame({ type: 'agent_done', nodeId: 'n2', agentName: 'patch', step, output: done({ agentName: 'patch', output: `v${round}`, round }) }))
  }

  out.push(frame({ type: 'agent_start', nodeId: 'n3', agentName: 'report', step: 4 }))
  out.push(frame({ type: 'agent_done', nodeId: 'n3', agentName: 'report', step: 4, output: done({ agentName: 'report', output: '', status: 'error', error: 'rate limited' }) }))
  out.push(frame({ type: 'run_complete', runId: 'r1' }))
  return out
}

async function fold(chunks: string[], instance = 0) {
  let states: InstanceRunMap = {}
  let order: InstanceOrder = {}
  const completed: string[] = []
  await streamRun(readerOf(chunks), (e: RunEvent) => {
    if (e.type === 'error') return
    if (e.type === 'run_complete') { completed.push(e.runId); return }
    states = applyInstanceEvent(states, instance, e)
    order = applyInstanceOrder(order, instance, e)
  })
  return { states, order, completed }
}

test('run-page fold: rail order, loop rounds, and card metadata', async () => {
  const { states, order, completed } = await fold(tape())
  const s = states[0]

  // rail lists each node once, in execution order — the loop node does not repeat
  assert.deepStrictEqual(orderFor(order, 0), ['n1', 'n2', 'n3'])

  // loop node keeps every round, latest output live
  assert.deepStrictEqual(s.n2.rounds, [{ round: 0, output: 'v0' }, { round: 1, output: 'v1' }, { round: 2, output: 'v2' }])
  assert.strictEqual(s.n2.output, 'v2')
  assert.strictEqual(s.n2.thought, 'think2')

  // the 6 fields the card renders survive the fold
  assert.strictEqual(s.n1.result?.systemPrompt, 'sys')
  assert.strictEqual(s.n1.result?.tokensIn, 10)
  assert.strictEqual(s.n1.result?.costUsd, 0.001)
  assert.strictEqual(s.n1.result?.latencyMs, 200)
  assert.strictEqual(s.n3.result?.error, 'rate limited')
  assert.strictEqual(s.n3.status, 'error')

  assert.deepStrictEqual(completed, ['r1'])
})

test('run-page fold: parallel instances stay independent', async () => {
  const a = await fold(tape(), 0)
  const b = await fold([
    frame({ type: 'agent_start', nodeId: 'n1', agentName: 'draft', step: 0 }),
    frame({ type: 'token', nodeId: 'n1', agentName: 'draft', token: 'other', step: 0 }),
  ], 1)

  // merging both instances' folds, as the page does across parallel runs
  const merged = { ...a.states, ...b.states }
  assert.strictEqual(merged[0].n1.output, 'draft')
  assert.strictEqual(merged[1].n1.output, 'other')
  assert.strictEqual(merged[1].n1.status, 'running')
  assert.strictEqual(merged[0].n1.status, 'success')
  assert.deepStrictEqual(orderFor(a.order, 0), ['n1', 'n2', 'n3'])
  assert.deepStrictEqual(orderFor(b.order, 1), ['n1'])
})

test('run-page fold: a frame split across chunk boundaries still lands', async () => {
  const raw = tape().join('')
  const cut = Math.floor(raw.length / 2)
  const { states, order } = await fold([raw.slice(0, cut), raw.slice(cut)])
  assert.deepStrictEqual(orderFor(order, 0), ['n1', 'n2', 'n3'])
  assert.strictEqual(states[0].n2.rounds.length, 3)
})
