import { test, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentOutput, ChatMessage, HoldRecord, RunMeta, ToolCallRecord } from '../lib/types'
import type { SectionWarning } from '../lib/sectionWarning'

// Routes take their root from the one request entry; a test hands in its own (#116).
const entry = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/requestWorkspace', async () => {
  const { diskWorkspace } = await import('../lib/runFolders')
  return { requestWorkspace: () => diskWorkspace(entry.root) }
})

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-export-'))
  entry.root = wp
  return wp
}

async function route() {
  return import('../app/api/runs/[runId]/export/route')
}

function output(nodeId: string, agentName: string, text: string): AgentOutput {
  return {
    nodeId, agentName, systemPrompt: '', input: 'in', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm',
    timestamp: 't', status: 'success',
  }
}

function meta(over: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: 'r1', chainName: 'relay', seedPrompt: 'go', startedAt: '2026-01-01T00:00:00.000Z',
    status: 'complete', agentOutputs: [], ...over,
  }
}

function writeRun(wp: string, runMeta: RunMeta) {
  write(wp, `logs/${runMeta.runId}/meta.json`, JSON.stringify(runMeta, null, 2))
}

async function callGET(runId: string, format: string) {
  const { GET } = await route()
  const url = `http://localhost/api/runs/${runId}/export?format=${format}`
  const request = { url } as import('next/server').NextRequest
  const response = await GET(request, { params: Promise.resolve({ runId }) })
  return response
}

// A promote-style rerun leaves two agentOutputs records for the same node id, latest
// last (#90). The markdown export is one section per agent, not a log.
test('markdown export renders the latest record per node id, not every record', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({
    runId: 'rerun-run',
    agentOutputs: [
      output('join', 'Join', 'first pass, stale'),
      output('creative-director', 'Creative Director', 'first pass, stale'),
      output('join', 'Join', 'second pass, latest'),
      output('creative-director', 'Creative Director', 'second pass, latest'),
    ],
  }))

  const response = await callGET('rerun-run', 'markdown')
  const md = await response.text()

  // Exactly one section per node id, and its content is the last write.
  assert.strictEqual((md.match(/## Agent: Join/g) ?? []).length, 1)
  assert.strictEqual((md.match(/## Agent: Creative Director/g) ?? []).length, 1)
  assert.ok(md.includes('second pass, latest'))
  assert.ok(!md.includes('first pass, stale'))
})

// Node order in the export follows each node's first appearance, matching the order a
// reader would meet the participants in — only the content updates to the rerun.
test('markdown export keeps each node at its first position, content refreshed', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({
    runId: 'rerun-order-run',
    agentOutputs: [
      output('a', 'A', 'a1'),
      output('b', 'B', 'b1'),
      output('a', 'A', 'a2'),
    ],
  }))

  const response = await callGET('rerun-order-run', 'markdown')
  const md = await response.text()
  const posA = md.indexOf('## Agent: A')
  const posB = md.indexOf('## Agent: B')
  assert.ok(posA < posB, 'A keeps its first-appearance position ahead of B')
  assert.ok(md.includes('a2'))
  assert.ok(!md.includes('a1'))
})

// An output recorded before graph capture (no nodeId) cannot be matched to any other
// record, so it is never collapsed away.
test('markdown export keeps every record that has no node id', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({
    runId: 'legacy-run',
    agentOutputs: [
      { ...output('x', 'Legacy', 'first'), nodeId: undefined },
      { ...output('x', 'Legacy', 'second'), nodeId: undefined },
    ],
  }))

  const response = await callGET('legacy-run', 'markdown')
  const md = await response.text()
  assert.strictEqual((md.match(/## Agent: Legacy/g) ?? []).length, 2)
  assert.ok(md.includes('first'))
  assert.ok(md.includes('second'))
})

// JSON export stays the raw meta.agentOutputs, every record — callers needing current
// state (buildLayoutModel, buildRunStateMap) do their own collapsing (#90).
test('json export is the raw meta, every agentOutputs record intact', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({
    runId: 'json-run',
    agentOutputs: [
      output('join', 'Join', 'first pass'),
      output('join', 'Join', 'second pass'),
    ],
  }))

  const response = await callGET('json-run', 'json')
  const body = JSON.parse(await response.text())
  assert.strictEqual(body.agentOutputs.length, 2)
  assert.strictEqual(body.agentOutputs[0].output, 'first pass')
  assert.strictEqual(body.agentOutputs[1].output, 'second pass')
})

test('markdown export renders tool loops with turn, tool name, args, and result', async () => {
  const wp = newWorkspace()
  const toolCalls: ToolCallRecord[] = [{
    turn: 1,
    name: 'retrieve',
    args: { query: 'history' },
    result: 'archive entry found',
    latencyMs: 42,
    isError: false,
  }]
  writeRun(wp, meta({
    runId: 'tool-run',
    agentOutputs: [
      { ...output('worker', 'Worker', 'final answer'), toolCalls, toolTurns: 1 },
    ],
  }))

  const response = await callGET('tool-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('## Tool Loop'))
  assert.ok(md.includes('### Turn 1 — 1 call, 42 ms total'))
  assert.ok(md.includes('#### 1.1 retrieve (42 ms)'))
  assert.ok(md.includes('"query": "history"'))
  assert.ok(md.includes('archive entry found'))
  assert.ok(md.includes('## Output'))
  assert.ok(md.includes('final answer'))
})

test('markdown export renders conversation turns with human and agent responses', async () => {
  const wp = newWorkspace()
  const conversation: ChatMessage[] = [
    { role: 'user', content: 'can you make it shorter?' },
    { role: 'assistant', content: 'here is the condensed version' },
  ]
  writeRun(wp, meta({
    runId: 'chat-run',
    agentOutputs: [
      { ...output('editor', 'Editor', 'first draft'), conversation },
    ],
  }))

  const response = await callGET('chat-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('## Conversation'))
  assert.ok(md.includes('**human:** can you make it shorter?'))
  assert.ok(md.includes('**Editor:** here is the condensed version'))
  assert.ok(md.includes('first draft'))
})

test('markdown export renders section warnings', async () => {
  const wp = newWorkspace()
  const warnings: SectionWarning[] = [
    { fromNode: 'researcher', section: 'findings', toNode: 'synthesizer', toSocket: 'notes' },
  ]
  writeRun(wp, meta({
    runId: 'warning-run',
    agentOutputs: [
      { ...output('researcher', 'Researcher', 'partial notes'), warnings },
    ],
  }))

  const response = await callGET('warning-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('## Warnings'))
  assert.ok(md.includes('researcher\'s output has no "findings" section — {notes} on synthesizer resolved to empty.'))
})

test('markdown export renders earlier turns for promoted outputs', async () => {
  const wp = newWorkspace()
  const priorTranscript: ChatMessage[] = [
    { role: 'user', content: 'try another angle' },
    { role: 'assistant', content: 'initial angle' },
  ]
  writeRun(wp, meta({
    runId: 'earlier-turns-run',
    agentOutputs: [
      { ...output('writer', 'Writer', 'refined angle'), priorTranscript },
    ],
  }))

  const response = await callGET('earlier-turns-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('## Earlier turns'))
  assert.ok(md.includes('**human:** try another angle'))
  assert.ok(md.includes('**Writer:** initial angle'))
  assert.ok(md.includes('refined angle'))
})

test('markdown export renders hold picks and records', async () => {
  const wp = newWorkspace()
  const holds: HoldRecord[] = [{
    nodeId: 'gate',
    prompt: 'Which layout direction should we proceed with?',
    input: 'raw input content',
    candidates: [{ heading: 'Candidate 1', body: 'Option 1' }],
    reachedAt: '2026-01-01T00:00:00.000Z',
    chosen: 'Candidate 1',
    direction: 'keep minimalism',
    resolvedAt: '2026-01-01T00:01:00.000Z',
  }]
  writeRun(wp, meta({
    runId: 'hold-run',
    holds,
    agentOutputs: [
      {
        ...output('gate', 'hold', 'PICK: Candidate 1\n\nkeep minimalism'),
        chosen: 'Candidate 1',
      },
    ],
  }))

  const response = await callGET('hold-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('Which layout direction should we proceed with?'))
  assert.ok(md.includes('Candidate 1'))
  assert.ok(md.includes('- **Hold Pick:** Candidate 1'))
  assert.ok(md.includes('## Holds'))
  assert.ok(md.includes('### Hold: gate'))
  assert.ok(md.includes('- **Status:** resolved'))
  assert.ok(md.includes('- **Resolved At:** 2026-01-01T00:01:00.000Z'))
  assert.ok(md.includes('- **Pick:** Candidate 1'))
  assert.ok(md.includes('- **Direction:** keep minimalism'))
})

test('markdown export renders custom hold picks', async () => {
  const wp = newWorkspace()
  const holds: HoldRecord[] = [{
    nodeId: 'gate-custom',
    input: 'What is your preferred alternative?',
    candidates: [],
    reachedAt: '2026-01-01T00:00:00.000Z',
    custom: 'My custom layout approach',
    direction: 'execute quickly',
    resolvedAt: '2026-01-01T00:01:00.000Z',
  }]
  writeRun(wp, meta({
    runId: 'custom-hold-run',
    holds,
  }))

  const response = await callGET('custom-hold-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('What is your preferred alternative?'))
  assert.ok(md.includes('My custom layout approach'))
  assert.ok(md.includes('- **Custom Pick:** My custom layout approach'))
})

test('markdown export renders thought blockquote', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({
    runId: 'thought-run',
    agentOutputs: [
      { ...output('thinker', 'Thinker', 'answer'), thought: 'pondering the options' },
    ],
  }))

  const response = await callGET('thought-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('> pondering the options'))
  assert.ok(md.includes('answer'))
})

test('markdown export renders custom pick on node header', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({
    runId: 'node-custom-pick-run',
    agentOutputs: [
      { ...output('gate', 'hold', 'PICK: custom\n\ndirection'), custom: 'custom solution' },
    ],
  }))

  const response = await callGET('node-custom-pick-run', 'markdown')
  const md = await response.text()

  assert.ok(md.includes('- **Custom Pick:** custom solution'))
})
