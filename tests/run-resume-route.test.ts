import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { AgentOutput, RunMeta } from '../lib/types'

// The model is the only stand-in: the executor, routes and logger are real.
const ran: { slug: string; systemPrompt: string }[] = []
vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: { slug: string; name: string }, systemPrompt: string): Promise<AgentOutput> => {
    ran.push({ slug: agent.slug, systemPrompt })
    return {
      agentName: agent.name, systemPrompt, input: '', output: `## Candidate 1\nfrom ${agent.slug}\n\n## Candidate 2\nsecond from ${agent.slug}`,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: new Date().toISOString(), status: 'success',
    }
  },
}))

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  ran.length = 0
  if (ORIGINAL_WORKSPACE === undefined) delete process.env.WORKSPACE_PATH
  else process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE
})

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

const twoHolds = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: mid
    kind: agent
    agent: after
  - id: hold2
    kind: hold
  - id: last
    kind: agent
    agent: after
edges:
  - from: seed
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: mid.direction
  - from: mid
    to: hold2.in
  - from: hold2
    to: last.direction
---
`

function newWorkspace(chain: string): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-resume-'))
  process.env.WORKSPACE_PATH = wp
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
  const { readRunMeta } = await import('../lib/logger')
  return readRunMeta(runId)
}

const logsOf = (wp: string, runId: string) =>
  fs.readdirSync(path.join(wp, 'logs', runId)).filter(f => f.endsWith('.md')).sort()

test('resume writes the hold log, runs what follows in the same folder, and completes', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  ran.length = 0

  const events = await sse(await resume(runId, { direction: 'KEEP: halo\nKILL: stance' }))

  assert.strictEqual(events[0].type, 'run_start')
  assert.strictEqual(events[0].runId, runId)
  assert.ok(events.some(e => e.type === 'layout'))
  assert.strictEqual(events.at(-1)!.type, 'run_complete')
  assert.strictEqual(events.at(-1)!.runId, runId)
  assert.deepStrictEqual(ran.map(r => r.slug), ['after'], 'only nodes after the hold execute')
  assert.ok(ran[0].systemPrompt.includes('<<KEEP: halo\nKILL: stance>>'), 'the Direction arrives verbatim')

  assert.deepStrictEqual(logsOf(wp, runId), ['00-dec.md', '01-hold.md', '02-after.md'])
  const holdLog = matter(fs.readFileSync(path.join(wp, 'logs', runId, '01-hold.md'), 'utf-8'))
  assert.strictEqual(holdLog.content.trim(), 'KEEP: halo\nKILL: stance')

  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'complete')
  assert.ok(meta.completedAt)
  assert.deepStrictEqual(meta.agentOutputs.map(o => o.nodeId), ['dec', 'hold', 'after'])
  assert.strictEqual(meta.holds?.length, 1)
  assert.strictEqual(meta.holds![0].direction, 'KEEP: halo\nKILL: stance')
  assert.ok(meta.holds![0].resolvedAt)
})

test('resume is refused unless the run is waiting', async () => {
  newWorkspace(oneHold)
  const runId = await startRun()
  await sse(await resume(runId, { direction: 'go' }))

  const again = await resume(runId, { direction: 'go again' })
  assert.strictEqual(again.status, 409)

  const { updateRunMeta } = await import('../lib/logger')
  updateRunMeta(runId, { status: 'running' })
  assert.strictEqual((await resume(runId, { direction: 'go' })).status, 409)
})

test('resume without a direction is a bad request; an unknown run is not found', async () => {
  newWorkspace(oneHold)
  const runId = await startRun()
  assert.strictEqual((await resume(runId, {})).status, 400)
  assert.strictEqual((await readMeta(runId)).status, 'waiting', 'a refused resume changes nothing')
  assert.strictEqual((await resume('no-such-run', { direction: 'x' })).status, 404)
})

test('resume keeps the version pins and the pre-hold logs the run started with', async () => {
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

test('a chain with two holds pauses twice and resumes twice in one run', async () => {
  const wp = newWorkspace(twoHolds)
  const runId = await startRun()

  const first = await sse(await resume(runId, { direction: 'first answer' }))
  const waiting = first.at(-1)!
  assert.strictEqual(waiting.type, 'run_waiting')
  assert.strictEqual(waiting.runId, runId)
  assert.strictEqual(waiting.nodeId, 'hold2')
  let meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'waiting')
  assert.deepStrictEqual(meta.holds?.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', true], ['hold2', false]])

  ran.length = 0
  const second = await sse(await resume(runId, { direction: 'second answer' }))
  assert.strictEqual(second.at(-1)!.type, 'run_complete')
  assert.deepStrictEqual(ran.map(r => r.slug), ['after'])
  assert.ok(ran[0].systemPrompt.includes('<<second answer>>'))

  assert.deepStrictEqual(logsOf(wp, runId), ['00-dec.md', '01-hold.md', '02-mid.md', '03-hold2.md', '04-last.md'])
  meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'complete')
  assert.deepStrictEqual(meta.holds?.map(h => [h.nodeId, h.direction]), [['hold', 'first answer'], ['hold2', 'second answer']])
})

test('resuming one of two wave-mate holds leaves the other open once, not twice', async () => {
  newWorkspace(oneHold.replace('edges:\n', `  - id: hold2
    kind: hold
edges:
  - from: dec
    to: hold2.in
`))
  const runId = await startRun()
  assert.strictEqual((await readMeta(runId)).holds?.length, 2)

  const events = await sse(await resume(runId, { direction: 'answer' }))
  assert.strictEqual(events.at(-1)!.type, 'run_waiting')

  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'waiting')
  assert.strictEqual(meta.holds?.length, 2)
  assert.strictEqual(meta.holds!.filter(h => !h.resolvedAt).length, 1)
})

test('resume with chosen composes PICK, the candidate body, then the Direction (#96)', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  const waiting = await readMeta(runId)
  assert.deepStrictEqual(waiting.holds![0].candidates, [
    { heading: 'Candidate 1', body: 'from decider' },
    { heading: 'Candidate 2', body: 'second from decider' },
  ])
  ran.length = 0

  const events = await sse(await resume(runId, { chosen: 'Candidate 2', direction: 'KEEP: halo' }))
  assert.strictEqual(events.at(-1)!.type, 'run_complete')

  const expected = 'PICK: Candidate 2\nsecond from decider\n\nKEEP: halo'
  assert.ok(ran[0].systemPrompt.includes(`<<${expected}>>`), 'greenlight-side reads the pick first')

  const holdLog = matter(fs.readFileSync(path.join(wp, 'logs', runId, '01-hold.md'), 'utf-8'))
  assert.strictEqual(holdLog.content.trim(), expected)
  assert.strictEqual(holdLog.data.chosen, 'Candidate 2')

  const meta = await readMeta(runId)
  assert.strictEqual(meta.holds![0].chosen, 'Candidate 2')
  assert.strictEqual(meta.holds![0].direction, 'KEEP: halo')
})

test('a branch past an answered hold logs the pick its lineage recorded (#100)', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  await sse(await resume(runId, { chosen: 'Candidate 2', direction: 'go' }))
  const branchOutputs = (await readMeta(runId)).agentOutputs.filter(o => o.nodeId !== 'after')

  const { POST } = await import('../app/api/run/route')
  const events = await sse(await POST({ json: async () => ({
    chainName: 'held', seedPrompt: 'go', branchedFromRunId: runId, branchedFromStep: 1, branchOutputs,
  }) } as import('next/server').NextRequest))
  const branchId = events[0].runId as string

  const holdLog = matter(fs.readFileSync(path.join(wp, 'logs', branchId, '01-hold.md'), 'utf-8'))
  assert.strictEqual(holdLog.data.chosen, 'Candidate 2')

  const again = await sse(await POST({ json: async () => ({
    chainName: 'held', seedPrompt: 'go', branchedFromRunId: branchId, branchedFromStep: 1, branchOutputs,
  }) } as import('next/server').NextRequest))
  const twiceLog = matter(fs.readFileSync(path.join(wp, 'logs', again[0].runId as string, '01-hold.md'), 'utf-8'))
  assert.strictEqual(twiceLog.data.chosen, 'Candidate 2', 'a branch of a branch still finds the pick')
})

test('resume with a chosen that names no candidate is a bad request (#96)', async () => {
  newWorkspace(oneHold)
  const runId = await startRun()
  assert.strictEqual((await resume(runId, { chosen: 'Candidate 9', direction: 'x' })).status, 400)
  assert.strictEqual((await resume(runId, { chosen: 7, direction: 'x' })).status, 400)
  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'waiting', 'a refused resume changes nothing')
  assert.strictEqual(meta.holds![0].chosen, undefined)
})

test('resume without chosen, or with a null one, leaves no pick in the record or the log (#96)', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  await sse(await resume(runId, { chosen: null, direction: 'go' }))
  const holdLog = matter(fs.readFileSync(path.join(wp, 'logs', runId, '01-hold.md'), 'utf-8'))
  assert.strictEqual(holdLog.data.chosen, undefined)
  assert.strictEqual((await readMeta(runId)).holds![0].chosen, undefined)
})

test('chosen matches a heading ignoring case and spacing, and records the heading as written (#96)', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  await sse(await resume(runId, { chosen: '  candidate   2 ', direction: 'go' }))
  const holdLog = matter(fs.readFileSync(path.join(wp, 'logs', runId, '01-hold.md'), 'utf-8'))
  assert.ok(holdLog.content.startsWith('PICK: Candidate 2\n'))
  assert.strictEqual(holdLog.data.chosen, 'Candidate 2')
  assert.strictEqual((await readMeta(runId)).holds![0].chosen, 'Candidate 2')
})

test('resume with custom composes PICK: custom and the human\'s own text, and records it (#96)', async () => {
  const wp = newWorkspace(oneHold)
  const runId = await startRun()
  ran.length = 0
  await sse(await resume(runId, { custom: 'Halo as a pet that grows', direction: 'KEEP: gameplay' }))

  const expected = 'PICK: custom\nHalo as a pet that grows\n\nKEEP: gameplay'
  assert.ok(ran[0].systemPrompt.includes(`<<${expected}>>`))
  const holdLog = matter(fs.readFileSync(path.join(wp, 'logs', runId, '01-hold.md'), 'utf-8'))
  assert.strictEqual(holdLog.content.trim(), expected)

  const hold = (await readMeta(runId)).holds![0]
  assert.strictEqual(hold.custom, 'Halo as a pet that grows')
  assert.strictEqual(hold.chosen, undefined)
})

test('resume refuses a custom pick sent with chosen, or a blank one (#96)', async () => {
  newWorkspace(oneHold)
  const runId = await startRun()
  assert.strictEqual((await resume(runId, { chosen: 'Candidate 1', custom: 'mine', direction: 'x' })).status, 400)
  assert.strictEqual((await resume(runId, { custom: '   ', direction: 'x' })).status, 400)
  assert.strictEqual((await resume(runId, { custom: 7, direction: 'x' })).status, 400)
  assert.strictEqual((await readMeta(runId)).status, 'waiting')
})
