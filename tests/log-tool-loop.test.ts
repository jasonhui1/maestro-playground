import { test, afterAll } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import type { AgentOutput, ToolCallRecord } from '../lib/types'

// writeAgentLog resolves its directory through getWorkspacePath(), which reads
// the env var at call time — so point it at a temp workspace before importing.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-log-'))
process.env.WORKSPACE_PATH = tmp

async function main() {
  const { writeAgentLog, initRunDir } = await import('../lib/logger')

  const runId = 'test-run'
  initRunDir({
    runId, chainName: 'c', seedPrompt: 's',
    startedAt: new Date().toISOString(), status: 'running', agentOutputs: [],
  })

  const base: AgentOutput = {
    nodeId: 'event-writer', agentName: 'event-writer', systemPrompt: 'write well',
    input: 'go', output: 'The tavern door swung open...\n\n## Summary\n- a thing happened',
    tokensIn: 3411, tokensOut: 1050, costUsd: 0.0123456789, latencyMs: 4200,
    model: 'test/model', timestamp: new Date().toISOString(), status: 'success',
  }

  const read = (step: number, label: string) =>
    fs.readFileSync(path.join(tmp, 'logs', runId, `${String(step).padStart(2, '0')}-${label}.md`), 'utf-8')

  // 1. Tool-less logs are unchanged: no headings, output starts the body.
  {
    writeAgentLog(runId, 0, base)
    const raw = read(0, 'event-writer')
    const { data, content } = matter(raw)

    assert.ok(!raw.includes('## Tool Loop'), 'no transcript section without tool calls')
    assert.ok(!raw.includes('## Output'), 'no ## Output heading without tool calls')
    assert.strictEqual(content.trim(), base.output, 'body is the output alone')
    assert.strictEqual('tool_turns' in data, false, 'tool_turns absent for tool-less nodes')
  }

  // 2. A single-call turn: turn heading states "1 call" + latency, nested call entry.
  {
    const toolCalls: ToolCallRecord[] = [{
      turn: 1, name: 'retrieve', args: { query: 'Gilded Flagon owner' },
      result: '### context/tavern-lore.md › The Gilded Flagon\nOwned by Mirna Copperhand since the fire of \'42.',
      latencyMs: 312, isError: false,
    }]
    writeAgentLog(runId, 1, { ...base, toolCalls, toolTurns: 1 })
    const raw = read(1, 'event-writer')
    const { data, content } = matter(raw)

    assert.strictEqual(data.tool_turns, 1)
    assert.ok(content.startsWith('## Tool Loop'), 'transcript precedes the output')
    assert.ok(content.includes('### Turn 1 — 1 call, 312 ms total'), 'turn heading states call count + summed latency')
    assert.ok(content.includes('#### 1.1 retrieve (312 ms)'), 'nested call entry numbered turn.call')
    assert.ok(content.includes('"query": "Gilded Flagon owner"'), 'args rendered as fenced json')
    assert.ok(content.includes('```json'))
    assert.ok(content.includes('Owned by Mirna Copperhand'), 'result verbatim')
    assert.ok(content.includes('## Output'), 'output is explicitly headed, not positional')
    assert.ok(
      content.indexOf('## Tool Loop') < content.indexOf('## Output'),
      'transcript comes first',
    )
    assert.ok(
      content.slice(content.indexOf('## Output')).includes('The tavern door swung open...'),
      'the output follows its heading',
    )
    assert.ok(!content.includes('folders'), 'executor config never reaches the log body')

    // A quoted result heading ("### context/...") must never be mistaken for a
    // turn heading: it must sit immediately after a fence-open line, i.e.
    // inside the fenced result block rather than as bare log structure.
    const resultLines = content.split('\n')
    const headingLineIdx = resultLines.findIndex(l => l.startsWith('### context/'))
    assert.ok(headingLineIdx > 0, 'quoted heading is present in the log')
    assert.ok(
      /^`{3,}text$/.test(resultLines[headingLineIdx - 1]),
      'quoted result heading is immediately preceded by a fence-open line, not read as log structure',
    )
  }

  // 3. Parallel turn: one turn heading for N calls, turnText against the turn
  // (not the first call), latency summed, each call nested and numbered.
  {
    const toolCalls: ToolCallRecord[] = [
      {
        turn: 1, name: 'retrieve', args: { query: 'Ashmoor' }, result: 'hit A',
        latencyMs: 2, isError: false, turnText: 'Let me check a few things.',
      },
      { turn: 1, name: 'retrieve', args: { query: 'Gilded Flagon' }, result: 'hit B', latencyMs: 0, isError: false },
      { turn: 1, name: 'retrieve', args: { query: 'Mirna' }, result: 'hit C', latencyMs: 0, isError: false },
      { turn: 1, name: 'retrieve', args: 'not json at all', result: 'Error: malformed JSON in tool arguments', latencyMs: 0, isError: true },
    ]
    writeAgentLog(runId, 2, { ...base, toolCalls, toolTurns: 1 })
    const { content } = matter(read(2, 'event-writer'))

    assert.strictEqual((content.match(/^### Turn \d/gm) || []).length, 1, 'four parallel calls read as one turn')
    assert.ok(content.includes('### Turn 1 — 4 calls, 2 ms total'), 'turn heading states 4 calls + summed latency')
    assert.ok(content.includes('**model:** Let me check a few things.'), 'turnText present')
    // turnText must render before the first nested call entry, i.e. against the turn.
    assert.ok(content.indexOf('**model:**') < content.indexOf('#### 1.1'), 'turnText renders against the turn, not the first call')
    assert.ok(content.includes('#### 1.1 retrieve (2 ms)'))
    assert.ok(content.includes('#### 1.2 retrieve (0 ms)'))
    assert.ok(content.includes('#### 1.3 retrieve (0 ms)'))
    assert.ok(content.includes('#### 1.4 retrieve (0 ms) — ERROR'), 'error call is marked on its own entry')
    assert.ok(content.includes('"not json at all"'), 'raw args are preserved when unparseable')
    // Only one turn-boundary rule for the whole group, not one per call.
    assert.strictEqual((content.match(/^---$/gm) || []).length, 1, 'turn boundary rule appears once per turn, not per call')
  }

  // 4. Two sequential turns stay visually distinct from each other and from
  // the call boundaries within each.
  {
    const toolCalls: ToolCallRecord[] = [
      { turn: 1, name: 'retrieve', args: { query: 'tavern' }, result: 'hit A', latencyMs: 10, isError: false },
      { turn: 1, name: 'retrieve', args: { query: 'owner' }, result: 'hit B', latencyMs: 11, isError: false },
      { turn: 2, name: 'retrieve', args: { query: 'ledger' }, result: 'hit C', latencyMs: 88, isError: false },
    ]
    writeAgentLog(runId, 3, { ...base, toolCalls, toolTurns: 2 })
    const { content } = matter(read(3, 'event-writer'))

    assert.ok(content.includes('### Turn 1 — 2 calls, 21 ms total'))
    assert.ok(content.includes('### Turn 2 — 1 call, 88 ms total'))
    assert.strictEqual((content.match(/^---$/gm) || []).length, 2, 'one boundary rule per turn')
  }

  // 5. A result containing a backtick run still fences correctly (bytes unchanged).
  {
    const trickyResult = 'here is code:\n```js\nconsole.log(1)\n```\nend'
    const toolCalls: ToolCallRecord[] = [{
      turn: 1, name: 'retrieve', args: { query: 'x' }, result: trickyResult, latencyMs: 5, isError: false,
    }]
    writeAgentLog(runId, 4, { ...base, toolCalls, toolTurns: 1 })
    const { content } = matter(read(4, 'event-writer'))

    assert.ok(content.includes(trickyResult), 'result bytes are unchanged, verbatim')
    // The fence wrapping the result must be longer than any backtick run inside it.
    const idx = content.indexOf(trickyResult)
    const before = content.slice(0, idx)
    const fenceMatch = before.match(/(`{3,})[a-z]*\n$/)
    assert.ok(fenceMatch, 'result is preceded by a fence line')
    assert.ok(fenceMatch![1].length > 3, 'fence widens beyond the backtick run inside the result')
  }
}

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('log-tool-loop', main)
