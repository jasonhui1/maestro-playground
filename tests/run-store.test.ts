// tests/run-store.test.ts
import { test } from 'vitest'
import assert from 'node:assert'
import { useRunStore, setRunTarget, fileRun } from '../hooks/store/useRunStore'

function sse(frames: object[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`))
      c.close()
    },
  })
  return new Response(body, { status: 200 })
}

const KEY = 'chain:demo'
const done = (output: string) => ({
  agentName: 'w', systemPrompt: '', input: '', output, thought: '', tokensIn: 0, tokensOut: 0,
  costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})

test('run-store — parallel instances route independently', async () => {
  // each instance gets its own stream; tag output with the instance index so we can assert routing
  let call = -1
  // override global fetch for the test
  global.fetch = async () => {
    call += 1
    const tag = `i${call}`
    return sse([
      { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 },
      { type: 'token', nodeId: 'a', token: tag, step: 0 },
      { type: 'agent_done', nodeId: 'a', agentName: 'w', step: 0, output: done(tag) },
    ])
  }

  setRunTarget(KEY, { type: 'chain', slug: 'demo', buildBody: (seed) => ({ seedPrompt: seed }) })
  useRunStore.getState().setSeed(KEY, 'hi')
  useRunStore.getState().setParallel(KEY, 2)

  await useRunStore.getState().run(KEY)

  const f = fileRun(KEY)
  assert.strictEqual(f.running, false)
  assert.strictEqual(f.instanceCount, 2)
  assert.strictEqual(f.error, null)
  // both instances completed, outputs are independent per instance
  assert.strictEqual(f.runState[0].a.status, 'success')
  assert.strictEqual(f.runState[1].a.status, 'success')
  assert.notStrictEqual(f.runState[0].a.output, f.runState[1].a.output)

  // reset clears results
  useRunStore.getState().reset(KEY)
  assert.deepStrictEqual(fileRun(KEY).runState, {})
})

test('run-store — a non-ok response sets error and clears running', async () => {
  // run-level failure: non-ok response sets error and leaves running=false
  // override global fetch
  global.fetch = async () => new Response(JSON.stringify({ error: 'bad chain' }), { status: 400 })
  setRunTarget('chain:bad', { type: 'chain', slug: 'bad', buildBody: () => ({}) })
  useRunStore.getState().setParallel('chain:bad', 1)
  await useRunStore.getState().run('chain:bad')
  const f = fileRun('chain:bad')
  assert.strictEqual(f.running, false)
  assert.strictEqual(f.error, 'bad chain')
})
