import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { createThoughtSplitter, splitThought, createStreamNarrator, streamOneTurn } from '../lib/runner'
import { runToolLoop, ChatCall } from '../lib/tools/loop'
import { assembleStreamedResponse, StreamChunk } from '../lib/tools/streamAssembly'
import { ToolLoopEvent } from '../lib/tools/events'
import { BoundTool } from '../lib/tools/registry'
import { ToolDef } from '../lib/types'

// ---- fixtures ---------------------------------------------------------------

const load = (provider: string): { chunks: StreamChunk[]; parallelChunks: StreamChunk[] } =>
  JSON.parse(fs.readFileSync(path.resolve(`tests/fixtures/streamed-tool-turn.${provider}.json`), 'utf8'))

function toolDef(over: Partial<ToolDef> = {}): ToolDef {
  return {
    slug: 'retrieve', name: 'retrieve', executor: 'retrieve',
    params: { query: { type: 'string', required: true } },
    config: {}, description: 'Search.', filePath: '', ...over,
  }
}

function bound(def: ToolDef, execute: BoundTool['execute']): BoundTool {
  return { def, jsonSchema: { type: 'object', properties: {}, required: [] }, execute }
}

const call = (id: string, name: string, args: string) =>
  ({ id, type: 'function', function: { name, arguments: args } })

// ---- the splitter -----------------------------------------------------------

test('thought splitter releases held-back text on flush', () => {
  // The pre-#35 inline parser held a trailing partial-tag prefix and never
  // flushed it at stream end, silently dropping it from the node's output.
  const seen: string[] = []
  const s = createThoughtSplitter(t => seen.push(t))
  s.push('3 is <')
  assert.deepStrictEqual(seen, ['3 is '], 'the trailing "<" is held: it may start <thought>')
  s.flush()
  assert.deepStrictEqual(seen, ['3 is ', '<'])
  assert.strictEqual(s.result().output, '3 is <')
})

test('splitter is delta-order independent and matches splitThought', () => {
  const whole = 'pre<thought>why</thought>post'
  for (const size of [1, 2, 3, 5, 7, 100]) {
    const s = createThoughtSplitter()
    for (let i = 0; i < whole.length; i += size) s.push(whole.slice(i, i + size))
    s.flush()
    assert.deepStrictEqual(s.result(), splitThought(whole), `chunked by ${size}`)
  }
  assert.deepStrictEqual(splitThought(whole), { output: 'prepost', thought: 'why' })
})

test('an unterminated <thought> still swallows the rest', () => {
  assert.deepStrictEqual(splitThought('a<thought>b'), { output: 'a', thought: 'b' })
})

// ---- the adapter's narration, replayed off real captures --------------------

test('narrator announces the first tool-call delta exactly once, on both providers', () => {
  for (const provider of ['google', 'openrouter']) {
    for (const key of ['chunks', 'parallelChunks'] as const) {
      const chunks = load(provider)[key]
      let announced = 0
      const n = createStreamNarrator({ onToolCallStart: () => announced++ })
      for (const c of chunks) n.push(c)
      n.flush()
      assert.strictEqual(announced, 1, `${provider}.${key} announces once`)
    }
  }
})

test('narrator surfaces gemma <thought> tags and deepseek reasoning through one callback', () => {
  const collect = (chunks: StreamChunk[]) => {
    const out: string[] = []
    const thought: string[] = []
    const n = createStreamNarrator({ onToken: (t, ty) => (ty === 'thought' ? thought : out).push(t) })
    for (const c of chunks) n.push(c)
    n.flush()
    return { output: out.join(''), thought: thought.join('') }
  }

  // deepseek's tool turn has zero content deltas; all of its thinking arrives on
  // `reasoning`, which is the case that used to leave the panel blank (#35).
  const ds = collect(load('openrouter').chunks)
  assert.strictEqual(ds.output, '')
  assert.ok(ds.thought.length > 0, 'deepseek reasoning reaches the thought stream')

  // gemma reasons inline, so the same callback sees it via the tag parser.
  const g = collect(load('google').chunks)
  assert.ok(g.output.length + g.thought.length > 0)
})

test('a stream that never calls a tool never announces', () => {
  const n = createStreamNarrator({ onToolCallStart: () => assert.fail('announced on a tool-less stream') })
  n.push({ choices: [{ delta: { content: 'just text' } }] })
  n.flush()
})

// ---- the loop stamps the turn ----------------------------------------------

test('the loop, not the adapter, stamps the in-flight turn', async () => {
  const events: ToolLoopEvent[] = []
  const tokens: Array<[string, string, number]> = []

  // Turn 1 makes two parallel calls, turn 2 answers. The adapter reports
  // turn-less facts; every turn number below came from the loop.
  const scripted: ChatCall = async (req, hooks) => {
    const isFirst = req.messages.filter(m => m.role === 'assistant').length === 0
    hooks?.onToken?.(isFirst ? 'looking' : 'done', 'output')
    if (!isFirst) return { choices: [{ message: { role: 'assistant', content: 'FINAL' } }] }
    hooks?.onToolCallStart?.()
    return {
      choices: [{
        message: {
          role: 'assistant', content: null,
          tool_calls: [call('a', 'retrieve', '{"query":"x"}'), call('b', 'lookup', '{"query":"y"}')],
        },
      }],
    }
  }

  const res = await runToolLoop(
    scripted,
    [bound(toolDef({ activity: 'Searching' }), async () => 'RA'),
     bound(toolDef({ slug: 'lookup', name: 'lookup' }), async () => 'RB')],
    [{ role: 'user', content: 'go' }],
    { maxToolTurns: 8 },
    { onEvent: e => events.push(e), onToken: (t, ty, turn) => tokens.push([t, ty, turn]) },
  )

  assert.strictEqual(res.finalText, 'FINAL')
  assert.deepStrictEqual(events.map(e => [e.type, e.turn]), [
    ['tool_pending', 1],
    ['tool_call', 1], ['tool_result', 1],
    ['tool_call', 1], ['tool_result', 1],
  ], 'two parallel calls share turn 1; the pending fact fires once for the turn')

  // The turn now in flight is toolTurns+1, so text streamed before any call was
  // seen still belongs to turn 1 — not turn 0.
  assert.deepStrictEqual(tokens, [['looking', 'output', 1], ['done', 'output', 2]])

  const callEv = events.find(e => e.type === 'tool_call')
  assert.strictEqual(callEv?.type === 'tool_call' && callEv.activity, 'Searching')
  const lookupEv = events.filter(e => e.type === 'tool_call')[1]
  assert.ok(lookupEv?.type === 'tool_call' && lookupEv.activity === undefined, 'no activity when the tool declares none')
})

test('an erroring tool reports isError and the loop keeps going', async () => {
  const events: ToolLoopEvent[] = []
  let turns = 0
  const scripted: ChatCall = async () => {
    turns++
    if (turns > 1) return { choices: [{ message: { role: 'assistant', content: 'RECOVERED' } }] }
    return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [call('a', 'retrieve', '{}')] } }] }
  }
  const res = await runToolLoop(
    scripted,
    [bound(toolDef(), async () => { throw new Error('boom') })],
    [{ role: 'user', content: 'go' }],
    { maxToolTurns: 8 },
    { onEvent: e => events.push(e) },
  )
  assert.strictEqual(res.finalText, 'RECOVERED')
  const result = events.find(e => e.type === 'tool_result')
  assert.ok(result?.type === 'tool_result' && result.isError)
})

test('the loop runs unchanged with no sink and no hooks', async () => {
  const scripted: ChatCall = async () => ({ choices: [{ message: { role: 'assistant', content: 'PLAIN' } }] })
  const res = await runToolLoop(scripted, [], [{ role: 'user', content: 'go' }], { maxToolTurns: 8 })
  assert.strictEqual(res.finalText, 'PLAIN')
  assert.strictEqual(res.toolTurns, 0)
})

test('reasoning accumulates across every turn, not just the last', async () => {
  // A node that thinks during its tool turns and answers with no reasoning must
  // not stream a full thought panel live and then persist an empty one (#35).
  let turns = 0
  const scripted: ChatCall = async () => {
    turns++
    if (turns > 1) return { choices: [{ message: { role: 'assistant', content: 'ANSWER' } }] }
    return {
      choices: [{
        message: {
          role: 'assistant', content: '', reasoning: 'I should look this up. ',
          tool_calls: [call('a', 'retrieve', '{}')],
        },
      }],
    }
  }
  const res = await runToolLoop(
    scripted, [bound(toolDef(), async () => 'R')], [{ role: 'user', content: 'go' }], { maxToolTurns: 8 },
  )
  assert.strictEqual(res.finalText, 'ANSWER')
  assert.strictEqual(res.reasoning, 'I should look this up. ', 'the tool turn"s reasoning survives to the settled result')
})

test('a turn that dies mid-body retries without re-narrating', async () => {
  const tokens: string[] = []
  let announced = 0
  let opened = 0

  // Attempt 1 streams two chunks then 503s; attempt 2 streams the whole turn.
  async function* attemptStream(): AsyncGenerator<StreamChunk> {
    const first = ++opened === 1
    yield { choices: [{ delta: { content: 'Let me ' } }] }
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'retrieve', arguments: '{' } }] } }] }
    if (first) throw Object.assign(new Error('upstream died'), { status: 503 })
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] }
    yield { choices: [{ delta: { content: 'look.' } }] }
  }

  const chunks = await streamOneTurn(
    async () => attemptStream(),
    { onToken: t => tokens.push(t), onToolCallStart: () => announced++ },
    { delayMs: 0 },
  )

  assert.strictEqual(opened, 2, 'the dead attempt was retried')
  assert.strictEqual(announced, 1, 'the same turn is announced once, not once per attempt')
  assert.deepStrictEqual(tokens, ['Let me '], 'the retry streams silently — the client already has this text')

  // assembly still sees only the surviving attempt's chunks
  assert.strictEqual(chunks.length, 4)
  const res = assembleStreamedResponse(chunks)
  assert.strictEqual(res.choices[0].message.tool_calls?.[0].function.arguments, '{}')
})
