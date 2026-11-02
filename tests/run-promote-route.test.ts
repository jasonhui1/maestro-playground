import { test, afterEach, vi } from 'vitest'
import { noModel } from '../lib/model'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { ChatMessage, RunMeta } from '../lib/types'
import { answer, fakeModel } from './helpers/fakeModel'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

// The model is the only stand-in: the executor, routes and logger are real.
const ran: { slug: string; systemPrompt: string }[] = []
const chats: ChatMessage[][] = []
requestEntry.model = fakeModel(({ messages, agentSlug, system }) => {
  if (messages.some(m => m.role === 'assistant')) {
    chats.push(messages as ChatMessage[])
    const n = messages.filter(m => m.role === 'user').length - 1 // the turn number
    return answer(`<thought>why ${n}</thought>revised ${n}`)
  }
  ran.push({ slug: agentSlug!, systemPrompt: system })
  return answer(agentSlug === 'decider' ? `## Candidate 1\nbuilt on [${system}]` : `first from ${agentSlug}`)
}).model

afterEach(() => {
  ran.length = 0
  chats.length = 0
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
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root, noModel)
  return runs.read(runId)
}

const logsOf = (wp: string, runId: string) =>
  fs.readdirSync(path.join(wp, 'logs', runId)).filter(f => f.endsWith('.md')).sort()
const logOf = (wp: string, runId: string, file: string) =>
  matter(fs.readFileSync(path.join(wp, 'logs', runId, file), 'utf-8'))

// Decisions, replay and persistence are the continuation's, tested in continue-run.test.ts. Here: parse → call → respond,
// and what node chat, layout and export read after a promote.
test('promote streams the rerun in the same run, back to the hold', async () => {
  newWorkspace()
  const runId = await startRun()
  await chat(runId, 'prop', 'push harder')

  const events = await sse(await promote(runId, 'prop'))

  assert.deepStrictEqual([events[0].type, events[0].runId], ['run_start', runId])
  assert.deepStrictEqual([events.at(-1)!.type, events.at(-1)!.runId, events.at(-1)!.nodeId], ['run_waiting', runId, 'hold'])
  assert.strictEqual((await readMeta(runId)).agentOutputs.findLast(o => o.nodeId === 'prop')!.output, 'revised 1')
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

test('a body promote cannot read is a bad request; an unknown run is not found', async () => {
  newWorkspace()
  const runId = await startRun()
  await chat(runId, 'prop', 'push')
  assert.strictEqual((await promote(runId, 'prop', { turn: 'one' })).status, 400)
  assert.strictEqual((await promote('no-such-run', 'prop')).status, 404)
  assert.strictEqual((await readMeta(runId)).status, 'waiting')
})

test('a chat after promote still knows the argument that led to the promoted reply', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  await chat(runId, 'prop', 'too complex')
  await chat(runId, 'prop', 'add risk')
  await sse(await promote(runId, 'prop'))
  chats.length = 0

  await chat(runId, 'prop', 'why that?')

  assert.deepStrictEqual(chats[0].slice(1).map(m => [m.role, m.content]), [
    ['user', chats[0][1].content],
    ['assistant', 'first from prop'],
    ['user', 'too complex'],
    ['assistant', 'revised 1'],
    ['user', 'add risk'],
    ['assistant', 'revised 2'],
    ['user', 'why that?'],
  ])
  assert.ok(chats[0].every(m => !m.thought), 'thought is never replayed')

  const meta = await readMeta(runId)
  const revision = meta.agentOutputs.findLast(o => o.nodeId === 'prop')!
  assert.strictEqual(revision.output, 'revised 2')
  assert.deepStrictEqual(revision.conversation!.map(m => m.content), ['why that?', 'revised 3'])

  const newLog = logsOf(wp, runId).filter(f => f.endsWith('-prop.md')).at(-1)!
  const body = logOf(wp, runId, newLog).content
  const order = ['## Earlier turns', 'first from prop', 'too complex', 'revised 1', 'add risk', '## Output', 'revised 2', '## Conversation', 'why that?']
  const at = order.map(t => body.indexOf(t))
  assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), `log order: ${body}`)
})

test('promoting twice keeps the whole argument', async () => {
  newWorkspace()
  const runId = await startRun()
  await chat(runId, 'prop', 'one')
  await sse(await promote(runId, 'prop'))
  await chat(runId, 'prop', 'two')
  await sse(await promote(runId, 'prop'))
  chats.length = 0

  await chat(runId, 'prop', 'three')

  assert.deepStrictEqual(chats[0].slice(2).map(m => m.content), [
    'first from prop', 'one', 'revised 1', 'two', 'revised 2', 'three',
  ])
})
