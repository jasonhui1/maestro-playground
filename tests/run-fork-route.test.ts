import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { AgentOutput, ChatMessage, RunMeta } from '../lib/types'

// The model is the only stand-in: the executor, routes and logger are real.
const ran: { slug: string; systemPrompt: string }[] = []
vi.mock('@/lib/runner', () => ({
  runAgent: async (
    agent: { slug: string; name: string },
    systemPrompt: string,
    userMessage: string,
    options: { history?: ChatMessage[] } = {},
  ): Promise<AgentOutput> => {
    const base = {
      agentName: agent.name, systemPrompt, input: userMessage,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: new Date().toISOString(),
    }
    if (options.history) {
      const n = options.history.filter(m => m.role === 'user').length - 1
      return { ...base, output: `revised ${n}`, status: 'success' }
    }
    ran.push({ slug: agent.slug, systemPrompt })
    const output = agent.slug === 'decider'
      ? `## Candidate 1\none [${systemPrompt}]\n\n## Candidate 2\ntwo`
      : `from ${agent.slug} <<${systemPrompt}>>`
    return { ...base, output, status: 'success' }
  },
}))

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  ran.length = 0
  if (ORIGINAL_WORKSPACE === undefined) delete process.env.WORKSPACE_PATH
  else process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE
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

const withSecondHold = chain
  .replace('edges:\n', '  - id: hold2\n    kind: hold\n  - id: last\n    kind: agent\n    agent: after\nedges:\n')
  .replace(/---\n$/, '  - from: after\n    to: hold2.in\n  - from: hold2\n    to: last.direction\n---\n')

function newWorkspace(chainText = chain): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-fork-'))
  process.env.WORKSPACE_PATH = wp
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

async function chat(runId: string, nodeId: string, message: string): Promise<void> {
  const { POST } = await import('../app/api/runs/[runId]/nodes/[nodeId]/chat/route')
  await sse(await POST({ json: async () => ({ message }) } as Req, { params: Promise.resolve({ runId, nodeId }) }))
}

async function promote(runId: string, nodeId: string, body: object = {}): Promise<Response> {
  const { POST } = await import('../app/api/runs/[runId]/nodes/[nodeId]/promote/route')
  return POST({ json: async () => body } as Req, { params: Promise.resolve({ runId, nodeId }) })
}

async function readMeta(runId: string): Promise<RunMeta> {
  const { readRunMeta } = await import('../lib/logger')
  return readRunMeta(runId)
}

async function listRuns(query: string): Promise<RunMeta[]> {
  const { GET } = await import('../app/api/runs/route')
  return (await GET({ url: `http://x/api/runs?${query}` } as Req)).json()
}

const logsOf = (wp: string, runId: string) =>
  fs.readdirSync(path.join(wp, 'logs', runId)).filter(f => f.endsWith('.md')).sort()

/** A run answered at its hold and complete. */
async function completeRun(): Promise<string> {
  const runId = await startRun()
  await sse(await resume(runId, { chosen: 'Candidate 1', direction: 'first answer' }))
  assert.strictEqual((await readMeta(runId)).status, 'complete')
  return runId
}

test('promote on a complete run forks at the node; the source run is unchanged but for the flag', async () => {
  const wp = newWorkspace()
  const sourceId = await completeRun()
  await chat(sourceId, 'prop', 'push')
  const before = await readMeta(sourceId)
  const sourceLogs = logsOf(wp, sourceId)
  ran.length = 0

  const events = await sse(await promote(sourceId, 'prop'))

  const forkId = events[0].runId as string
  assert.notStrictEqual(forkId, sourceId)
  assert.strictEqual(events.at(-1)!.type, 'run_waiting', 'the fork reaches the hold again')
  assert.strictEqual(events.at(-1)!.runId, forkId)
  assert.deepStrictEqual(ran.map(r => r.slug), ['decider'], 'only the node\'s descendants run')
  assert.ok(ran[0].systemPrompt.includes('revised 1'))

  const fork = await readMeta(forkId)
  assert.strictEqual(fork.branchedFromRunId, sourceId)
  assert.strictEqual(fork.branchedFromNode, 'prop')
  assert.strictEqual(fork.branchedFromStep, undefined)
  assert.strictEqual(fork.status, 'waiting')
  assert.deepStrictEqual(fork.agentOutputs.map(o => o.nodeId), ['prop', 'dec'], 'the revision replaces the node; its descendants are dropped')
  assert.strictEqual(fork.agentOutputs[0].output, 'revised 1')
  assert.ok(fork.agentOutputs[0].priorTranscript?.length, 'the argument travels with the revision')
  assert.deepStrictEqual(fork.holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', false]])
  assert.deepStrictEqual(logsOf(wp, forkId), ['00-prop.md', '01-dec.md'])
  assert.deepStrictEqual(fork.graph, before.graph)

  const source = await readMeta(sourceId)
  assert.strictEqual(source.status, 'complete')
  assert.deepStrictEqual(logsOf(wp, sourceId), sourceLogs)
  assert.deepStrictEqual(source.agentOutputs.map(o => o.output), before.agentOutputs.map(o => o.output))
  assert.deepStrictEqual(source.holds, before.holds)
  assert.strictEqual(source.agentOutputs.find(o => o.nodeId === 'prop')!.conversation![1].promoted, true)
})

test('promote past an answered hold on a waiting run forks, keeping holds above the node', async () => {
  newWorkspace(withSecondHold)
  const sourceId = await startRun()
  await sse(await resume(sourceId, { direction: 'first answer' }))
  assert.strictEqual((await readMeta(sourceId)).status, 'waiting')
  await chat(sourceId, 'after', 'push')
  await chat(sourceId, 'prop', 'push')

  const inPlace = await sse(await promote(sourceId, 'after'))
  assert.strictEqual(inPlace[0].runId, sourceId, 'a hold below the node only stays in place')

  const events = await sse(await promote(sourceId, 'prop'))
  const forkId = events[0].runId as string
  assert.notStrictEqual(forkId, sourceId)
  const fork = await readMeta(forkId)
  assert.strictEqual(fork.branchedFromNode, 'prop')
  assert.deepStrictEqual(fork.holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', false]], 'answered holds below the node are asked again')
  assert.strictEqual((await readMeta(sourceId)).status, 'waiting', 'the source stays where it was')
})

test('a second resume of an answered hold forks with the new answer', async () => {
  const wp = newWorkspace()
  const sourceId = await completeRun()
  const before = await readMeta(sourceId)
  ran.length = 0

  const events = await sse(await resume(sourceId, { chosen: 'Candidate 2', direction: 'second answer' }))

  const forkId = events[0].runId as string
  assert.notStrictEqual(forkId, sourceId)
  assert.strictEqual(events.at(-1)!.type, 'run_complete')
  assert.deepStrictEqual(ran.map(r => r.slug), ['after'], 'only what follows the hold runs')
  assert.ok(ran[0].systemPrompt.includes('PICK: Candidate 2\ntwo\n\nsecond answer'))

  const fork = await readMeta(forkId)
  assert.strictEqual(fork.branchedFromRunId, sourceId)
  assert.strictEqual(fork.branchedFromNode, 'hold')
  assert.strictEqual(fork.status, 'complete')
  assert.deepStrictEqual(fork.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'hold', 'after'])
  assert.strictEqual(fork.holds!.length, 1)
  assert.strictEqual(fork.holds![0].chosen, 'Candidate 2')
  assert.strictEqual(fork.holds![0].direction, 'second answer')
  assert.ok(fork.holds![0].resolvedAt)
  assert.deepStrictEqual(logsOf(wp, forkId), ['00-prop.md', '01-dec.md', '02-hold.md', '03-after.md'])
  assert.strictEqual(matter(fs.readFileSync(path.join(wp, 'logs', forkId, '02-hold.md'), 'utf-8')).data.chosen, 'Candidate 2')

  assert.deepStrictEqual(await readMeta(sourceId), before, 'the source run is untouched')
})

test('a re-answer with a custom pick drops the earlier chosen heading', async () => {
  newWorkspace()
  const sourceId = await completeRun()
  const events = await sse(await resume(sourceId, { custom: 'mine', direction: 'x' }))
  const hold = (await readMeta(events[0].runId as string)).holds![0]
  assert.strictEqual(hold.custom, 'mine')
  assert.strictEqual(hold.chosen, undefined)
})

test('with several holds, a re-answer names the hold; an answered one on a waiting run forks', async () => {
  newWorkspace(withSecondHold)
  const sourceId = await startRun()
  await sse(await resume(sourceId, { direction: 'first answer' }))

  const events = await sse(await resume(sourceId, { holdId: 'hold', direction: 'again' }))
  const forkId = events[0].runId as string
  assert.notStrictEqual(forkId, sourceId)
  const fork = await readMeta(forkId)
  assert.strictEqual(fork.branchedFromNode, 'hold')
  assert.deepStrictEqual(fork.holds!.map(h => [h.nodeId, h.direction ?? null]), [['hold', 'again'], ['hold2', null]])

  await sse(await resume(sourceId, { direction: 'second answer' }))
  const source = await readMeta(sourceId)
  assert.strictEqual(source.status, 'complete')
  assert.strictEqual((await resume(sourceId, { direction: 'which?' })).status, 400, 'two answered holds: holdId is required')
  assert.strictEqual((await resume(sourceId, { holdId: 'nope', direction: 'x' })).status, 404)
  const again = await sse(await resume(sourceId, { holdId: 'hold2', direction: 'third' }))
  assert.strictEqual((await readMeta(again[0].runId as string)).branchedFromNode, 'hold2')
})

test('a fork is refused while the source run is running', async () => {
  newWorkspace()
  const sourceId = await completeRun()
  await chat(sourceId, 'prop', 'push')
  const { updateRunMeta } = await import('../lib/logger')
  updateRunMeta(sourceId, { status: 'running' })
  assert.strictEqual((await resume(sourceId, { direction: 'x' })).status, 409)
  assert.strictEqual((await promote(sourceId, 'prop')).status, 409)
})

test('the run list filters by branchedFromRunId', async () => {
  newWorkspace()
  const sourceId = await completeRun()
  const other = await completeRun()
  const fork = (await sse(await resume(sourceId, { direction: 'again' })))[0].runId
  await sse(await resume(other, { direction: 'again' }))

  const forks = await listRuns(`branchedFromRunId=${sourceId}`)
  assert.deepStrictEqual(forks.map(r => r.runId), [fork])
})
