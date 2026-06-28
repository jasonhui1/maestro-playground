import assert from 'node:assert'
import { streamRun, RunEvent } from '../lib/runStream'

function streamFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  }).getReader()
}

const events: RunEvent[] = []
// a frame deliberately split across two chunks
const reader = streamFromChunks([
  'data: {"type":"agent_start","nodeId":"a","agentName":"writer","step":0}\n\n',
  'data: {"type":"tok',
  'en","nodeId":"a","token":"hi","step":0}\n\ndata: {"type":"agent_done","nodeId":"a","agentName":"writer","step":0,"output":{"output":"hi there"}}\n\n',
  'data: {"type":"run_complete","runId":"r1"}\n\n',
])

async function run() {
  await streamRun(reader, e => events.push(e))

  assert.deepStrictEqual(events.map(e => e.type), ['agent_start', 'token', 'agent_done', 'run_complete'])
  assert.strictEqual((events[1] as Extract<RunEvent, { type: 'token' }>).token, 'hi')
  assert.strictEqual((events[3] as Extract<RunEvent, { type: 'run_complete' }>).runId, 'r1')

  console.log('✅ run-stream tests passed')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
