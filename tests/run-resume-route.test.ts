import { test, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { AgentOutput, RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

// The model is the only stand-in: the executor, routes and logger are real.
vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: { slug: string; name: string }, systemPrompt: string): Promise<AgentOutput> => {
    return {
      agentName: agent.name, systemPrompt, input: '', output: `## Candidate 1\nfrom ${agent.slug}\n\n## Candidate 2\nsecond from ${agent.slug}`,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: new Date().toISOString(), status: 'success',
    }
  },
}))

const oneHold = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`

function newWorkspace(chain: string): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-resume-'))
  requestEntry.root = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('chains/held.md', chain)
  write('agents/decider.md', '---\nname: Decider\n---\ndecide {input}\n')
  write('agents/after.md', '---\nname: After\n---\nbuild on <<{direction}>>\n')
  return wp
}

type Event = { type: string; [k: string]: unknown }

async function sse(res: Response): Promise<Event[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

async function startRun(): Promise<string> {
  const { POST } = await import('../app/api/run/route')
  const events = await sse(await POST({ json: async () => ({ chainName: 'held', seedPrompt: 'go' }) } as import('next/server').NextRequest))
  assert.strictEqual(events.at(-1)!.type, 'run_waiting')
  return events.at(-1)!.runId as string
}

async function resume(runId: string, body: object): Promise<Response> {
  const { POST } = await import('../app/api/runs/[runId]/resume/route')
  return POST(
    { json: async () => body } as import('next/server').NextRequest,
    { params: Promise.resolve({ runId }) },
  )
}

async function readMeta(runId: string): Promise<RunMeta> {
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root)
  return runs.read(runId)
}


// Decisions, replay and persistence are the continuation's, tested in continue-run.test.ts; this is parse → call → respond.
test('resume streams the run to its end in the same folder', async () => {
  newWorkspace(oneHold)
  const runId = await startRun()

  const events = await sse(await resume(runId, { direction: 'KEEP: halo' }))

  assert.deepStrictEqual([events[0].type, events[0].runId], ['run_start', runId])
  assert.deepStrictEqual([events.at(-1)!.type, events.at(-1)!.runId], ['run_complete', runId])
  assert.strictEqual((await readMeta(runId)).status, 'complete')
})

test('resume keeps the version pins and the pre-hold logs the run started with (ADR-0011)', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  const before = await readMeta(runId)
  const decLog = fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8')

  // A live edit between pause and resume must not rewrite what the run started with.
  fs.writeFileSync(path.join(wp, 'chains/held.md'), oneHold.replace('name: held', 'name: held\ndescription: edited'))
  await sse(await resume(runId, { direction: 'go' }))

  const after = await readMeta(runId)
  assert.deepStrictEqual(after.versions, before.versions)
  assert.strictEqual(after.versionNumber, before.versionNumber)
  assert.strictEqual(fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8'), decLog)
  const afterLog = matter(fs.readFileSync(path.join(wp, 'logs', runId, '02-after.md'), 'utf-8'))
  assert.ok((afterLog.data.version_number as number) > (before.versionNumber ?? 0), 'a post-hold log carries the version it ran with')
})

test('a body resume cannot read is a bad request and changes nothing; an unknown run is not found', async () => {
  newWorkspace(oneHold)
  const runId = await startRun()
  for (const body of [
    {},
    { chosen: 7, direction: 'x' },
    { custom: '   ', direction: 'x' },
    { custom: 7, direction: 'x' },
    { direction: 'go', fork: true },
    { direction: 'go', chosen: 'Candidate 1', fork: 'yes' },
  ]) {
    assert.strictEqual((await resume(runId, body)).status, 400, JSON.stringify(body))
  }
  assert.strictEqual((await readMeta(runId)).status, 'waiting', 'a refused resume changes nothing')
  assert.strictEqual((await resume('no-such-run', { direction: 'x' })).status, 404)
})
