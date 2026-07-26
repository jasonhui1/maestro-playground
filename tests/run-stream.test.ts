import { test } from 'vitest'
import assert from 'node:assert'
import { streamRun, RunEvent } from '../lib/runStream'

test('run-stream', async () => {
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

  }

  await run()

  // the three tool frames the route emits during a tool-using run (#35)
  const toolEvents: RunEvent[] = []
  await streamRun(streamFromChunks([
    'data: {"type":"tool_pending","nodeId":"a","step":0,"kind":"agent","turn":1}\n\n',
    'data: {"type":"tool_call","nodeId":"a","step":0,"kind":"agent","turn":1,"name":"retrieve","args":{"query":"x"},"activity":"Searching"}\n\n',
    'data: {"type":"tool_result","nodeId":"a","step":0,"kind":"agent","turn":1,"name":"retrieve","result":"## Houses\\nAldric","latencyMs":412,"isError":false}\n\n',
  ]), e => toolEvents.push(e))

  assert.deepStrictEqual(toolEvents.map(e => e.type), ['tool_pending', 'tool_call', 'tool_result'])
  const callFrame = toolEvents[1] as Extract<RunEvent, { type: 'tool_call' }>
  assert.strictEqual(callFrame.activity, 'Searching')
  assert.strictEqual(callFrame.turn, 1)
  assert.strictEqual(callFrame.kind, 'agent')
  const resultFrame = toolEvents[2] as Extract<RunEvent, { type: 'tool_result' }>
  assert.strictEqual(resultFrame.latencyMs, 412)
  assert.strictEqual(resultFrame.isError, false)
  assert.strictEqual(resultFrame.result, '## Houses\nAldric', 'the result body crosses the wire (#36)')
})
