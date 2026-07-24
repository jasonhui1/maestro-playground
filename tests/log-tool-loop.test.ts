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

  // 2. A tool-using node: transcript section, then an explicit ## Output.
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
    assert.ok(content.includes('### Turn 1 — retrieve (312 ms)'), 'turn heading carries name + latency')
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
  }

  // 3. Multi-call turn with intermediate model text, and an error turn marked.
  {
    const toolCalls: ToolCallRecord[] = [
      {
        turn: 1, name: 'retrieve', args: { query: 'tavern' }, result: 'hit A',
        latencyMs: 10, isError: false, turnText: 'Let me check two things.',
      },
      { turn: 1, name: 'retrieve', args: { query: 'owner' }, result: 'hit B', latencyMs: 11, isError: false },
      {
        turn: 2, name: 'retrieve', args: 'not json at all', result: 'Error: malformed JSON in tool arguments',
        latencyMs: 0, isError: true,
      },
    ]
    writeAgentLog(runId, 2, { ...base, toolCalls, toolTurns: 2 })
    const { content } = matter(read(2, 'event-writer'))

    assert.ok(content.includes('**model:** Let me check two things.'), 'intermediate text is not dropped')
    assert.strictEqual(
      (content.match(/### Turn 1 — retrieve/g) || []).length, 2,
      'both calls of a parallel turn are rendered under turn 1',
    )
    assert.ok(content.includes('### Turn 2 — retrieve (0 ms) — ERROR'), 'error turns are marked')
    assert.ok(content.includes('"not json at all"'), 'raw args are preserved when unparseable')
  }

  fs.rmSync(tmp, { recursive: true, force: true })
}

main().then(() => console.log('log-tool-loop tests passed')).catch((err) => {
  fs.rmSync(tmp, { recursive: true, force: true })
  console.error(err)
  process.exit(1)
})
