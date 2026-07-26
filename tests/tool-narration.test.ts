import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { applyRunEvent, RunStateMap, emptyNodeState } from '../lib/runState'
import { narrationOf } from '../lib/toolNarration'
import { RunEvent } from '../lib/runStream'
import { streamOneTurn } from '../lib/runner'
import { runToolLoop, ChatCall, ChatCallResponse } from '../lib/tools/loop'
import { assembleStreamedResponse, StreamChunk } from '../lib/tools/streamAssembly'
import { BoundTool } from '../lib/tools/registry'
import { AgentOutput, ToolCallRecord, ToolDef } from '../lib/types'

const fold = (events: RunEvent[]): RunStateMap => events.reduce(applyRunEvent, {} as RunStateMap)

const start: RunEvent = { type: 'agent_start', nodeId: 'n1', agentName: 'lore', step: 0, kind: 'agent' }

const done = (over: Partial<AgentOutput> = {}): RunEvent => ({
  type: 'agent_done', nodeId: 'n1', agentName: 'lore', step: 0, kind: 'agent',
  output: { agentName: 'lore', input: '', systemPrompt: '', output: 'FINAL', tokensIn: 0, tokensOut: 0,
    costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...over } as AgentOutput,
})

test('a tool-less node narrates nothing and keeps its output', () => {
  const s = fold([start, { type: 'token', nodeId: 'n1', token: 'hello', tokenType: 'output' }])
  const n = narrationOf(s.n1)
  assert.deepStrictEqual(n.turns, [])
  assert.strictEqual(n.isNarrating, false)
  assert.strictEqual(n.answer, 'hello')
})

test('parallel calls in one turn are one row of several chips', () => {
  // The #26 regression, restated at the panel's seam: four calls in one
  // assistant message must not read as four turns.
  const s = fold([
    start,
    { type: 'tool_pending', nodeId: 'n1', turn: 1 },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: { q: 'a' }, activity: 'Searching lore' },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: { q: 'b' }, activity: 'Searching lore' },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: { q: 'c' }, activity: 'Searching lore' },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'lookup', args: { q: 'd' } },
  ])
  const n = narrationOf(s.n1)
  assert.strictEqual(n.turns.length, 1)
  assert.strictEqual(n.turns[0].calls.length, 4)
  assert.strictEqual(n.isNarrating, true)
})

test('a chip runs from pending through executing to resolved', () => {
  let s = fold([start, { type: 'tool_pending', nodeId: 'n1', turn: 1 }])
  let n = narrationOf(s.n1)
  assert.deepStrictEqual(n.turns.map(t => [t.turn, t.pending, t.calls.length]), [[1, true, 0]],
    'pending fills the silence before any call has arguments')

  s = applyRunEvent(s, { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {}, activity: 'Searching lore' })
  n = narrationOf(s.n1)
  assert.strictEqual(n.turns[0].pending, false)
  assert.deepStrictEqual(n.turns[0].calls.map(c => [c.label, c.status]), [['Searching lore', 'running']])

  s = applyRunEvent(s, { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', result: 'THE BODY', latencyMs: 240, isError: false })
  n = narrationOf(s.n1)
  assert.deepStrictEqual(n.turns[0].calls.map(c => [c.status, c.latencyMs, c.result]), [['done', 240, 'THE BODY']])
  assert.strictEqual(n.turns[0].latencyMs, 240, 'the row sums its chips')
})

test('a chip with no activity label falls back to the tool name', () => {
  const s = fold([start, { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'lookup', args: {} }])
  assert.strictEqual(narrationOf(s.n1).turns[0].calls[0].label, 'lookup')
})

test('a failed call is marked and the node keeps running', () => {
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', result: 'Error: boom', latencyMs: 1200, isError: true },
    { type: 'tool_call', nodeId: 'n1', turn: 2, name: 'retrieve', args: {} },
  ])
  const n = narrationOf(s.n1)
  assert.strictEqual(n.turns[0].calls[0].isError, true)
  assert.strictEqual(s.n1.status, 'running', 'a failed call is not a failed node')
  assert.strictEqual(n.turns.length, 2, 'the loop carried on into turn 2')
})

test("a turn's text belongs to that turn, live or replayed", () => {
  // Live, the text arrives as tokens stamped with the turn; replayed, it rides
  // on the turn's first record. Both must land on the same row.
  const live = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'token', nodeId: 'n1', token: 'checking three ', tokenType: 'output', turn: 1 },
    { type: 'token', nodeId: 'n1', token: 'sources', tokenType: 'output', turn: 1 },
  ])
  assert.strictEqual(narrationOf(live.n1).turns[0].turnText, 'checking three sources')

  const record: ToolCallRecord = {
    turn: 1, name: 'retrieve', args: {}, result: 'R', latencyMs: 5, isError: false, turnText: 'checking three sources',
  }
  const replayed = fold([start, done({ toolCalls: [record], toolTurns: 1 })])
  assert.strictEqual(narrationOf(replayed.n1).turns[0].turnText, 'checking three sources')
})

test('the final turn is the answer, not another row of chips', () => {
  // The loop stamps every turn, including the one that answers — so the answer
  // arrives as turn text for a turn that never made a call.
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', result: 'R', latencyMs: 10, isError: false },
    { type: 'token', nodeId: 'n1', token: 'Aldric ', tokenType: 'output', turn: 2 },
    { type: 'token', nodeId: 'n1', token: 'Vane rules', tokenType: 'output', turn: 2 },
  ])
  const n = narrationOf(s.n1)
  assert.deepStrictEqual(n.turns.map(t => t.turn), [1], 'turn 2 made no calls, so it is not a turn row')
  assert.strictEqual(n.answer, 'Aldric Vane rules', 'it streams as the answer')
})

test('the settled output supersedes the streamed answer', () => {
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'token', nodeId: 'n1', token: 'partial', tokenType: 'output', turn: 2 },
    done({ toolCalls: [{ turn: 1, name: 'retrieve', args: {}, result: 'R', latencyMs: 5, isError: false }], toolTurns: 1 }),
  ])
  assert.strictEqual(narrationOf(s.n1).answer, 'FINAL')
})

test('a turn that announced calls but executed none still answers', () => {
  // The forced final turn (tool_choice "none") can emit tool-call deltas and then
  // answer anyway: tool_pending fires, no call ever executes. Keying the answer on
  // the pending row would stream it invisibly behind "preparing tools…".
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', result: 'R', latencyMs: 10, isError: false },
    { type: 'tool_pending', nodeId: 'n1', turn: 2 },
    { type: 'token', nodeId: 'n1', token: 'the answer', tokenType: 'output', turn: 2 },
  ])
  assert.strictEqual(narrationOf(s.n1).answer, 'the answer')
})

test('plain text before a turn declares calls becomes that turn\'s note', () => {
  // A model that writes a preamble and then calls tools: the text is the answer
  // while nothing has executed, and reclassifies once the turn owns a call. The
  // wire cannot tell these apart earlier — no turn announces its intent.
  let s = fold([
    start,
    { type: 'token', nodeId: 'n1', token: 'checking three sources', tokenType: 'output', turn: 1 },
  ])
  assert.strictEqual(narrationOf(s.n1).answer, 'checking three sources')

  s = applyRunEvent(s, { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} })
  const n = narrationOf(s.n1)
  assert.strictEqual(n.answer, '', 'it belongs to the turn, not the answer pane')
  assert.strictEqual(n.turns[0].turnText, 'checking three sources')
})

test('an idle node narrates nothing', () => {
  const n = narrationOf(emptyNodeState())
  assert.deepStrictEqual(n.turns, [])
  assert.strictEqual(n.answer, '')
  assert.strictEqual(n.isNarrating, false)
})

// ---- end to end, on real provider bytes -------------------------------------

const fixture = (provider: string): { parallelChunks: StreamChunk[] } =>
  JSON.parse(fs.readFileSync(path.resolve(`tests/fixtures/streamed-tool-turn.${provider}.json`), 'utf8'))

const asChunks = (chunks: StreamChunk[]) => async function* () { for (const c of chunks) yield c }()

const loreTool: ToolDef = {
  slug: 'lore_lookup', name: 'lore_lookup', executor: 'retrieve', activity: 'Searching lore',
  params: { query: { type: 'string', required: true } }, config: {},
  description: 'Search established lore.', filePath: '',
}

const answerChunks: StreamChunk[] = [
  { choices: [{ delta: { content: 'Aldric Vane ' } }] },
  { choices: [{ delta: { content: 'rules the northern reach.' } }] },
]

// Both providers' captured parallel turn fires two lore_lookups in one assistant
// message — the shape that must never render as two turns.
for (const provider of ['google', 'openrouter']) {
  test(`${provider}: a real parallel turn narrates as one row of two chips`, async () => {
    const turns = [fixture(provider).parallelChunks, answerChunks]
    let i = 0
    const chatCall: ChatCall = async (_req, hooks) => {
      const received = await streamOneTurn(async () => asChunks(turns[i++]), hooks, { delayMs: 0 })
      return assembleStreamedResponse(received) as ChatCallResponse
    }

    const bound: BoundTool = {
      def: loreTool,
      jsonSchema: { type: 'object', properties: {}, required: [] },
      execute: async () => '## Houses of Ashmoor\n\nAldric Vane holds the northern reach.',
    }

    // The route's own translation: loop events gain a nodeId, tokens keep their turn.
    const events: RunEvent[] = []
    await runToolLoop(chatCall, [bound], [{ role: 'user', content: 'who rules the north?' }], { maxToolTurns: 6 }, {
      onEvent: e => events.push({ ...e, nodeId: 'n1' }),
      onToken: (token, type, turn) => events.push({ type: 'token', nodeId: 'n1', token, tokenType: type, turn }),
    })

    const state = fold([start, ...events])
    const n = narrationOf(state.n1)

    assert.strictEqual(n.turns.length, 1, 'two calls in one message are one turn')
    assert.deepStrictEqual(n.turns[0].calls.map(c => [c.label, c.status, c.isError]),
      [['Searching lore', 'done', false], ['Searching lore', 'done', false]])
    assert.ok(n.turns[0].calls.every(c => c.result.includes('Houses of Ashmoor')),
      'each chip carries its whole result body, mid-run')
    assert.strictEqual(n.answer, 'Aldric Vane rules the northern reach.',
      'the answering turn is the answer, not a third chip')
  })
}
