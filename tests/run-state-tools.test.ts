import { test } from 'vitest'
import assert from 'node:assert'
import { applyRunEvent, toolTurnsOf, RunStateMap } from '../lib/runState'
import { RunEvent } from '../lib/runStream'
import { AgentOutput, ToolCallRecord } from '../lib/types'

const fold = (events: RunEvent[]): RunStateMap => events.reduce(applyRunEvent, {} as RunStateMap)

const start: RunEvent = { type: 'agent_start', nodeId: 'n1', agentName: 'writer', step: 0, kind: 'agent' }

const done = (over: Partial<AgentOutput> = {}): RunEvent => ({
  type: 'agent_done', nodeId: 'n1', agentName: 'writer', step: 0, kind: 'agent',
  output: { agentName: 'writer', input: '', systemPrompt: '', output: 'FINAL', tokensIn: 0, tokensOut: 0,
    costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...over } as AgentOutput,
})

test('parallel calls in one turn produce one turn group, never several', () => {
  // The failure this guards is #26's: one assistant message carrying four calls
  // rendered as four turns. The live state must group the way the log does.
  const s = fold([
    start,
    { type: 'tool_pending', nodeId: 'n1', turn: 1 },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: { q: 'a' }, activity: 'Searching' },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: { q: 'b' } },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'lookup', args: { q: 'c' } },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'lookup', args: { q: 'd' } },
  ])

  const groups = toolTurnsOf(s.n1)
  assert.strictEqual(groups.length, 1)
  assert.strictEqual(groups[0].turn, 1)
  assert.strictEqual(groups[0].calls.length, 4)
})

test('a second turn opens a second group', () => {
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', latencyMs: 10, isError: false },
    { type: 'tool_call', nodeId: 'n1', turn: 2, name: 'retrieve', args: {} },
  ])
  assert.deepStrictEqual(toolTurnsOf(s.n1).map(g => [g.turn, g.calls.length]), [[1, 1], [2, 1]])
})

test('pending marks the turn, and the turn\'s first call clears it', () => {
  let s = fold([start, { type: 'tool_pending', nodeId: 'n1', turn: 1 }])
  assert.strictEqual(s.n1.pendingTurn, 1)
  assert.strictEqual(s.n1.toolCalls.length, 0, 'pending carries no call identity')

  s = applyRunEvent(s, { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} })
  assert.strictEqual(s.n1.pendingTurn, undefined)

  // a later turn can go pending again while turn 1's calls stay put
  s = applyRunEvent(s, { type: 'tool_pending', nodeId: 'n1', turn: 2 })
  assert.strictEqual(s.n1.pendingTurn, 2)
  assert.strictEqual(s.n1.toolCalls.length, 1)
})

test('results settle the matching call; errors are marked', () => {
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    // parallel calls to the same tool settle in completion order, not call order
    { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', latencyMs: 5, isError: true },
    { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'retrieve', latencyMs: 90, isError: false },
  ])
  assert.deepStrictEqual(
    s.n1.toolCalls.map(c => [c.status, c.latencyMs, c.isError]),
    [['done', 5, true], ['done', 90, false]],
  )
  assert.strictEqual(toolTurnsOf(s.n1)[0].latencyMs, 95, 'group latency sums its calls')
})

test('a result with no matching open call is inert', () => {
  const s = fold([start, { type: 'tool_result', nodeId: 'n1', turn: 1, name: 'ghost', latencyMs: 1, isError: false }])
  assert.strictEqual(s.n1.toolCalls.length, 0)
})

test('tokens with a turn narrate that turn; tokens without one are the output', () => {
  const s = fold([
    start,
    { type: 'token', nodeId: 'n1', token: 'thinking about ', tokenType: 'output', turn: 1 },
    { type: 'token', nodeId: 'n1', token: 'it', tokenType: 'output', turn: 1 },
    { type: 'token', nodeId: 'n1', token: 'answer', tokenType: 'output' },
    { type: 'token', nodeId: 'n1', token: 'why', tokenType: 'thought', turn: 1 },
  ])
  assert.deepStrictEqual(s.n1.turnText, { 1: 'thinking about it' })
  assert.strictEqual(s.n1.output, 'answer', 'turn narration never lands in the answer pane')
  assert.strictEqual(s.n1.thought, 'why')
})

test('the settled transcript supersedes the live one at agent_done', () => {
  const record: ToolCallRecord = {
    turn: 1, name: 'retrieve', args: { q: 'a' }, result: 'THE RESULT',
    latencyMs: 42, isError: false, turnText: 'let me look',
  }
  const s = fold([
    start,
    { type: 'tool_pending', nodeId: 'n1', turn: 1 },
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: { q: 'a' } },
    done({ toolCalls: [record], toolTurns: 1 }),
  ])
  // events deliberately omit result text; the payload carries it
  assert.strictEqual(s.n1.toolCalls.length, 1)
  assert.strictEqual(s.n1.toolCalls[0].result, 'THE RESULT')
  assert.strictEqual(s.n1.toolCalls[0].status, 'done')
  assert.strictEqual(s.n1.pendingTurn, undefined, 'a finished node is never mid-compose')
  assert.strictEqual(toolTurnsOf(s.n1)[0].turnText, 'let me look')
})

test('a tool-less node keeps its old shape', () => {
  const s = fold([start, { type: 'token', nodeId: 'n1', token: 'hi', tokenType: 'output' }, done()])
  assert.deepStrictEqual(s.n1.toolCalls, [])
  assert.deepStrictEqual(s.n1.turnText, {})
  assert.strictEqual(s.n1.output, 'FINAL')
  assert.strictEqual(s.n1.status, 'success')
})

test('a re-run clears the previous pass\'s tool state', () => {
  const s = fold([
    start,
    { type: 'tool_call', nodeId: 'n1', turn: 1, name: 'retrieve', args: {} },
    { type: 'token', nodeId: 'n1', token: 'x', tokenType: 'output', turn: 1 },
    start,
  ])
  assert.deepStrictEqual(s.n1.toolCalls, [])
  assert.deepStrictEqual(s.n1.turnText, {})
})
