import { test, afterEach } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentOutput, RunMeta } from '../lib/types'

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  if (ORIGINAL_WORKSPACE === undefined) delete process.env.WORKSPACE_PATH
  else process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE
})

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-layout-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

async function route() {
  return import('../app/api/runs/[runId]/layout/route')
}

function output(nodeId: string, text: string, round?: number): AgentOutput {
  return {
    nodeId, agentName: 'Relay', systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm',
    timestamp: '', status: 'success', round,
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

function timelineChain() {
  return `---
name: relay
view: timeline
outputs:
  - name: hop 1
    node: first
    socket: summary
  - name: hop 2
    node: second
    socket: summary
nodes: []
edges: []
---
`
}

function columnsChain() {
  return `---
name: columns-chain
view: columns
outputs:
  - name: left
    node: a
    socket: summary
  - name: right
    node: b
    socket: summary
    role: join
nodes: []
edges: []
---
`
}

function sidebarChain() {
  return `---
name: sidebar-chain
view: sidebar
outputs:
  - name: reflection
    node: loop
    socket: summary
nodes: []
edges: []
---
`
}

function undeclaredChain() {
  return `---
name: undeclared-chain
nodes: []
edges: []
---
`
}

async function callGET(runId: string) {
  const { GET } = await route()
  const request = {} as import('next/server').NextRequest
  const response = await GET(request, { params: Promise.resolve({ runId }) })
  return { status: response.status, body: await response.json() }
}

test('timeline: a completed run projects outputs onto its declared panels', async () => {
  const wp = newWorkspace()
  write(wp, 'chains/relay.md', timelineChain())
  writeRun(wp, meta({
    runId: 'timeline-run',
    agentOutputs: [
      output('first', 'noise\n\n## Summary\nalpha'),
      output('second', 'noise\n\n## Summary\nbeta'),
    ],
  }))

  const { status, body } = await callGET('timeline-run')
  assert.strictEqual(status, 200)
  assert.strictEqual(body.kind, 'timeline')
  assert.deepStrictEqual(body.panels.map((p: { text: string }) => p.text), ['alpha', 'beta'])
  assert.strictEqual(body.panels[1].emphasis, 'last')
})

test('columns: only the join port carries emphasis', async () => {
  const wp = newWorkspace()
  write(wp, 'chains/columns-chain.md', columnsChain())
  writeRun(wp, meta({
    runId: 'columns-run', chainName: 'columns-chain',
    agentOutputs: [output('a', 'left text'), output('b', 'right text')],
  }))

  const { status, body } = await callGET('columns-run')
  assert.strictEqual(status, 200)
  assert.strictEqual(body.kind, 'columns')
  assert.strictEqual(body.panels[0].emphasis, undefined)
  assert.strictEqual(body.panels[1].emphasis, 'join')
})

test('sidebar: one panel per loop round', async () => {
  const wp = newWorkspace()
  write(wp, 'chains/sidebar-chain.md', sidebarChain())
  writeRun(wp, meta({
    runId: 'sidebar-run', chainName: 'sidebar-chain',
    agentOutputs: [
      output('loop', 'round zero', 0),
      output('loop', 'round one', 1),
    ],
  }))

  const { status, body } = await callGET('sidebar-run')
  assert.strictEqual(status, 200)
  assert.strictEqual(body.kind, 'sidebar')
  assert.deepStrictEqual(body.panels.map((p: { round: number }) => p.round), [0, 1])
})

test('undeclared: a chain with no view falls back to an empty model', async () => {
  const wp = newWorkspace()
  write(wp, 'chains/undeclared-chain.md', undeclaredChain())
  writeRun(wp, meta({ runId: 'undeclared-run', chainName: 'undeclared-chain', agentOutputs: [output('a', 'text')] }))

  const { status, body } = await callGET('undeclared-run')
  assert.strictEqual(status, 200)
  assert.deepStrictEqual(body, { kind: 'undeclared', panels: [] })
})

test('a run still in progress reports its unreached panels as pending', async () => {
  const wp = newWorkspace()
  write(wp, 'chains/relay.md', timelineChain())
  writeRun(wp, meta({
    runId: 'pending-run', status: 'running',
    agentOutputs: [output('first', 'noise\n\n## Summary\nalpha')],
  }))

  const { status, body } = await callGET('pending-run')
  assert.strictEqual(status, 200)
  assert.strictEqual(body.panels[0].state, 'filled')
  assert.strictEqual(body.panels[1].state, 'pending')
})

test('a run whose chain no longer resolves falls back to an empty model, not a 404', async () => {
  const wp = newWorkspace()
  writeRun(wp, meta({ runId: 'orphan-run', chainName: 'deleted-chain', agentOutputs: [output('a', 'text')] }))

  const { status, body } = await callGET('orphan-run')
  assert.strictEqual(status, 200)
  assert.deepStrictEqual(body, { kind: 'undeclared', panels: [] })
})

test('an unknown run 404s with a JSON error', async () => {
  newWorkspace()
  const { status, body } = await callGET('does-not-exist')
  assert.strictEqual(status, 404)
  assert.deepStrictEqual(body, { error: 'Run not found' })
})
