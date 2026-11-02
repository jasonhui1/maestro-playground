import { test, afterEach, vi } from 'vitest'
import { noModel } from '../lib/model'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { RunMeta } from '../lib/types'
import { answer, fakeModel } from './helpers/fakeModel'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

// The model is the only stand-in: the executor, routes and logger are real.
const ran: { slug: string; systemPrompt: string }[] = []
requestEntry.model = fakeModel(({ agentSlug, system }) => {
  ran.push({ slug: agentSlug!, systemPrompt: system })
  return answer(agentSlug === 'decider' ? `## Candidate 1\none [${system}]\n\n## Candidate 2\ntwo` : `from ${agentSlug} <<${system}>>`)
}).model

afterEach(() => {
  ran.length = 0
})

const chain = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: prop
    kind: agent
    agent: prop
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
    to: prop.input
  - from: prop
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`

function newWorkspace(chainText = chain): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-fork-'))
  requestEntry.root = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('chains/held.md', chainText)
  write('agents/prop.md', '---\nname: Prop\n---\npropose {input}\n')
  write('agents/decider.md', '---\nname: Decider\n---\ndecide {input}\n')
  write('agents/after.md', '---\nname: After\n---\nbuild on {direction}\n')
  return wp
}

type Event = { type: string; [k: string]: unknown }
type Req = import('next/server').NextRequest

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
  const events = await sse(await POST({ json: async () => ({ chainName: 'held', seedPrompt: 'go' }) } as Req))
  return events.at(-1)!.runId as string
}

async function resume(runId: string, body: object): Promise<Response> {
  const { POST } = await import('../app/api/runs/[runId]/resume/route')
  return POST({ json: async () => body } as Req, { params: Promise.resolve({ runId }) })
}

async function readMeta(runId: string): Promise<RunMeta> {
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root, noModel)
  return runs.read(runId)
}

async function listRuns(query: string): Promise<RunMeta[]> {
  const { GET } = await import('../app/api/runs/route')
  return (await GET({ url: `http://x/api/runs?${query}` } as Req)).json()
}


/** A run answered at its hold and complete. */
async function completeRun(): Promise<string> {
  const runId = await startRun()
  await sse(await resume(runId, { chosen: 'Candidate 1', direction: 'first answer' }))
  assert.strictEqual((await readMeta(runId)).status, 'complete')
  return runId
}

test('the run list filters by branchedFromRunId', async () => {
  newWorkspace()
  const sourceId = await completeRun()
  const other = await completeRun()
  const fork = (await sse(await resume(sourceId, { direction: 'again' })))[0].runId
  await sse(await resume(other, { direction: 'again' }))

  const forks = await listRuns(`branchedFromRunId=${sourceId}`)
  assert.deepStrictEqual(forks.map(r => r.runId), [fork])
})

async function fork(runId: string, body: object): Promise<Response> {
  const { POST } = await import('../app/api/runs/[runId]/fork/route')
  return POST({ json: async () => body } as Req, { params: Promise.resolve({ runId }) })
}

// Decisions, replay and persistence are the continuation's, tested in continue-run.test.ts. Here: parse → call → respond,
// the run list, and the version store a pinned fork reads.
test('a fork streams a new run branched from the source', async () => {
  newWorkspace()
  const sourceId = await completeRun()
  const events = await sse(await fork(sourceId, { from: 'after' }))
  const forkId = events[0].runId as string
  assert.notStrictEqual(forkId, sourceId)
  assert.strictEqual(events.at(-1)!.type, 'run_complete')
  assert.strictEqual((await readMeta(forkId)).branchedFromRunId, sourceId)
})

test('a fork runs current files by default, or the source run\'s pins when asked (#103, ADR-0011)', async () => {
  const wp = newWorkspace()
  const sourceId = await completeRun()
  const source = await readMeta(sourceId)
  fs.writeFileSync(path.join(wp, 'agents/after.md'), '---\nname: After\n---\nrebuild on {direction}\n')

  ran.length = 0
  const current = await readMeta((await sse(await fork(sourceId, { from: 'after' })))[0].runId as string)
  assert.ok(ran[0].systemPrompt.startsWith('rebuild on'))
  assert.notDeepStrictEqual(current.versions, source.versions)

  ran.length = 0
  const pinned = await readMeta((await sse(await fork(sourceId, { from: 'after', versions: 'pinned' })))[0].runId as string)
  assert.ok(ran[0].systemPrompt.startsWith('build on'))
  assert.deepStrictEqual(pinned.versions, source.versions)
})

test('a pinned fork refuses when a pinned version is gone (#103)', async () => {
  const wp = newWorkspace()
  const sourceId = await completeRun()
  fs.rmSync(path.join(wp, '.versions', 'agent', 'after'), { recursive: true })
  assert.strictEqual((await fork(sourceId, { from: 'after', versions: 'pinned' })).status, 422)
})

test('fork refuses a body it cannot read; an unknown run is not found (#103, #160)', async () => {
  newWorkspace()
  const sourceId = await completeRun()
  for (const body of [
    {},
    { revisions: { prop: 3 } },
    { from: 'prop', revisions: { prop: 'x' } },
    { from: 'prop', versions: 'latest' },
    { revisions: { prop: { output: 'All', notes: 'Part' } } },
  ]) {
    assert.strictEqual((await fork(sourceId, body)).status, 400, JSON.stringify(body))
  }
  assert.strictEqual((await fork('no-such-run', { from: 'prop' })).status, 404)
})

test('/api/run refuses the retired branch request rather than running from scratch (#103)', async () => {
  newWorkspace()
  const { POST } = await import('../app/api/run/route')
  const res = await POST({ json: async () => ({ chainName: 'held', seedPrompt: 'go', branchOutputs: [] }) } as Req)
  assert.strictEqual(res.status, 400)
  assert.deepStrictEqual(ran, [])
})

test('capabilities reports addressedRevisions: true (#160)', async () => {
  newWorkspace()
  const { GET } = await import('../app/api/workspace/route')
  const body = await (await GET()).json() as { capabilities: Record<string, boolean> }
  assert.strictEqual(body.capabilities.addressedRevisions, true)
})
