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
      const n = options.history.filter(m => m.role === 'user').length - 1 // the turn number
      return { ...base, output: `revised ${n}`, thought: `why ${n}`, status: 'success' }
    }
    ran.push({ slug: agent.slug, systemPrompt })
    const output = agent.slug === 'decider'
      ? `## Candidate 1\nbuilt on [${systemPrompt}]`
      : `first from ${agent.slug}`
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
  - id: other
    kind: agent
    agent: prop
  - id: j
    kind: join
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
  - from: seed
    to: other.input
  - from: prop
    to: j.in
  - from: other
    to: j.in
  - from: j
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`

function newWorkspace(chainText = chain): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-promote-'))
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

async function sse(res: Response): Promise<Event[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

type Req = import('next/server').NextRequest

async function startRun(): Promise<string> {
  const { POST } = await import('../app/api/run/route')
  const events = await sse(await POST({ json: async () => ({ chainName: 'held', seedPrompt: 'go' }) } as Req))
  assert.strictEqual(events.at(-1)!.type, 'run_waiting')
  return events.at(-1)!.runId as string
}

async function chat(runId: string, nodeId: string, message: string): Promise<void> {
  const { POST } = await import('../app/api/runs/[runId]/nodes/[nodeId]/chat/route')
  const events = await sse(await POST({ json: async () => ({ message }) } as Req, { params: Promise.resolve({ runId, nodeId }) }))
  assert.strictEqual(events.at(-1)!.type, 'chat_done')
}

async function promote(runId: string, nodeId: string, body: object = {}): Promise<Response> {
  const { POST } = await import('../app/api/runs/[runId]/nodes/[nodeId]/promote/route')
  return POST({ json: async () => body } as Req, { params: Promise.resolve({ runId, nodeId }) })
}

async function readMeta(runId: string): Promise<RunMeta> {
  const { readRunMeta } = await import('../lib/logger')
  return readRunMeta(runId)
}

const logsOf = (wp: string, runId: string) =>
  fs.readdirSync(path.join(wp, 'logs', runId)).filter(f => f.endsWith('.md')).sort()
const logOf = (wp: string, runId: string, file: string) =>
  matter(fs.readFileSync(path.join(wp, 'logs', runId, file), 'utf-8'))

test('promote makes the latest reply the output, reruns to the hold, and keeps the run waiting', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  const before = await readMeta(runId)
  const logsBefore = logsOf(wp, runId)
  await chat(runId, 'prop', 'push harder')
  await chat(runId, 'prop', 'again')
  ran.length = 0

  const events = await sse(await promote(runId, 'prop'))

  assert.strictEqual(events[0].type, 'run_start')
  assert.strictEqual(events.at(-1)!.type, 'run_waiting')
  assert.strictEqual(events.at(-1)!.runId, runId)
  assert.strictEqual(events.at(-1)!.nodeId, 'hold')
  assert.deepStrictEqual(ran.map(r => r.slug), ['decider'], 'only the nodes between the proposer and the hold run')
  assert.ok(ran[0].systemPrompt.includes('revised 2'), 'the decider reads the promoted reply')
  assert.ok(ran[0].systemPrompt.includes('first from prop'), 'a sibling proposer replays its output')

  const logs = logsOf(wp, runId)
  assert.deepStrictEqual(logs.slice(0, logsBefore.length), logsBefore, 'earlier logs stay as earlier steps')
  const added = logs.slice(logsBefore.length)
  assert.deepStrictEqual(added.map(f => f.replace(/^\d+-/, '')), ['prop.md', 'j.md', 'dec.md'])
  assert.strictEqual(logOf(wp, runId, added[0]).content.trim(), 'revised 2')

  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'waiting')
  assert.strictEqual(meta.holds?.length, 1, 'the hold record is replaced, not duplicated')
  assert.ok(!meta.holds![0].resolvedAt)
  assert.ok(meta.holds![0].candidates[0].body.includes('revised 2'), 'candidates reflect the new verdict')
  assert.notStrictEqual(meta.holds![0].reachedAt, before.holds![0].reachedAt)

  const ids = meta.agentOutputs.map(o => o.nodeId)
  for (const id of ['prop', 'j', 'dec']) assert.strictEqual(ids.filter(x => x === id).length, 2, `${id} keeps its earlier record`)
  const latest = (id: string) => meta.agentOutputs.findLast(o => o.nodeId === id)!
  assert.strictEqual(latest('prop').output, 'revised 2')
  assert.strictEqual(latest('dec').output, meta.holds![0].input)
  assert.strictEqual(meta.agentOutputs.find(o => o.nodeId === 'dec')!.output, before.holds![0].input)
})

test('the promoted turn is flagged in the source conversation and its log', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  const propLog = logsOf(wp, runId).find(f => f.endsWith('-prop.md'))!
  await chat(runId, 'prop', 'push harder')
  await chat(runId, 'prop', 'again')

  await sse(await promote(runId, 'prop', { turn: 1 }))

  const meta = await readMeta(runId)
  const source = meta.agentOutputs.find(o => o.nodeId === 'prop')!
  assert.deepStrictEqual(source.conversation!.map(m => m.promoted ?? false), [false, true, false, false])
  assert.strictEqual(meta.agentOutputs.findLast(o => o.nodeId === 'prop')!.output, 'revised 1', 'turn picks an earlier reply')
  const log = logOf(wp, runId, propLog).content
  assert.match(log, /### Turn 1[\s\S]*promoted[\s\S]*### Turn 2/)
  assert.doesNotMatch(log.split('### Turn 2')[1], /promoted/)
})

test('layout and markdown export read the promoted outputs', async () => {
  newWorkspace(chain.replace('name: held\n', 'name: held\nview: columns\n').replace(/---\n$/, `outputs:
  - name: pitch
    node: prop
  - name: verdict
    node: dec
---
`))
  const runId = await startRun()
  await chat(runId, 'prop', 'push harder')
  await sse(await promote(runId, 'prop'))
  const meta = await readMeta(runId)
  const latestDec = meta.agentOutputs.findLast(o => o.nodeId === 'dec')!.output
  const staleDec = meta.agentOutputs.find(o => o.nodeId === 'dec')!.output
  assert.notStrictEqual(latestDec, staleDec)

  const params = { params: Promise.resolve({ runId }) }
  const layoutRoute = await import('../app/api/runs/[runId]/layout/route')
  const layout = await (await layoutRoute.GET({} as Req, params)).json()
  assert.deepStrictEqual(layout.panels.map((p: { text: string }) => p.text), ['revised 1', latestDec])

  const exportRoute = await import('../app/api/runs/[runId]/export/route')
  const md = await (await exportRoute.GET({ url: 'http://x/export' } as Req, params)).text()
  assert.ok(md.includes('revised 1'))
  assert.ok(!md.includes(staleDec), 'the stale verdict does not show')
})

test('promote is refused unless the run is waiting', async () => {
  newWorkspace()
  const runId = await startRun()
  await chat(runId, 'prop', 'push')
  const { updateRunMeta } = await import('../lib/logger')

  updateRunMeta(runId, { status: 'running' })
  assert.strictEqual((await promote(runId, 'prop')).status, 409)
  updateRunMeta(runId, { status: 'complete' })
  const complete = await promote(runId, 'prop')
  assert.strictEqual(complete.status, 409)
  assert.match((await complete.json()).error, /#99|fork/i)
  assert.strictEqual((await promote('no-such-run', 'prop')).status, 404)
})

test('promote needs a reply to promote, from a proposer in the run', async () => {
  newWorkspace()
  const runId = await startRun()
  assert.strictEqual((await promote(runId, 'prop')).status, 400, 'no conversation yet')
  await chat(runId, 'prop', 'push')
  assert.strictEqual((await promote(runId, 'prop', { turn: 2 })).status, 400)
  assert.strictEqual((await promote(runId, 'prop', { turn: 0 })).status, 400)
  assert.strictEqual((await promote(runId, 'prop', { turn: 'one' })).status, 400)
  assert.strictEqual((await promote(runId, 'j')).status, 400)
  assert.strictEqual((await promote(runId, 'nope')).status, 404)

  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'waiting', 'a refused promote changes nothing')
  assert.ok(!meta.agentOutputs.some(o => o.conversation?.some(m => m.promoted)))
})

test('promote across an answered hold is refused: that is a fork (#99)', async () => {
  newWorkspace(chain.replace('  - from: hold\n    to: after.direction\n', `  - from: hold
    to: after.direction
  - from: after
    to: hold2.in
`).replace('edges:\n', '  - id: hold2\n    kind: hold\nedges:\n'))
  const runId = await startRun()
  const { POST } = await import('../app/api/runs/[runId]/resume/route')
  const events = await sse(await POST({ json: async () => ({ direction: 'go' }) } as Req, { params: Promise.resolve({ runId }) }))
  assert.strictEqual(events.at(-1)!.nodeId, 'hold2')
  await chat(runId, 'prop', 'push')
  await chat(runId, 'after', 'push')

  assert.strictEqual((await promote(runId, 'prop')).status, 409)
  const ok = await sse(await promote(runId, 'after'))
  assert.strictEqual(ok.at(-1)!.type, 'run_waiting')
  const meta = await readMeta(runId)
  assert.deepStrictEqual(meta.holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', true], ['hold2', false]])
})
