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
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-export-'))
  process.env.WORKSPACE_PATH = wp
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

// A promote-style rerun (spec de-risk 4) leaves two agentOutputs records for the same
// node id, latest last. The markdown export is a one-section-per-agent narrative, so a
// stale first attempt rendered alongside the real result reads as two answers for one
// question (#90).
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

// The JSON export is the same full-history record GET /api/runs/:id already returns
// (tier 2 of vision.md's promise: content knowable from the log). It intentionally
// keeps every record rather than projecting to the latest per node — readers that need
// "the current state" (buildLayoutModel, buildRunStateMap) do that collapsing
// themselves from this same raw array.
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
