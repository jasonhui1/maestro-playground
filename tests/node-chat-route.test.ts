import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { AgentOutput, ChatMessage, RunMeta } from '../lib/types'

// The model is the only stand-in: the executor, routes and logger are real.
const chats: ChatMessage[][] = []
vi.mock('@/lib/runner', () => ({
  runAgent: async (
    agent: { slug: string; name: string },
    systemPrompt: string,
    userMessage: string,
    options: { history?: ChatMessage[]; onToken?: (t: string, type?: 'thought' | 'output') => void } = {},
  ): Promise<AgentOutput> => {
    const base = {
      agentName: agent.name, systemPrompt, input: userMessage,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: new Date().toISOString(),
    }
    if (!options.history) {
      return { ...base, output: `## Candidate 1\nfrom ${agent.slug}`, status: 'success' }
    }
    chats.push(options.history)
    if (userMessage === 'fail') return { ...base, output: '', status: 'error', error: 'model down' }
    const n = options.history.filter(m => m.role === 'user').length - 1
    options.onToken?.('hmm', 'thought')
    options.onToken?.(`reply ${n}`, 'output')
    return { ...base, output: `reply ${n}`, thought: 'hmm', status: 'success' }
  },
}))

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  chats.length = 0
  if (ORIGINAL_WORKSPACE === undefined) delete process.env.WORKSPACE_PATH
  else process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE
})

const chain = `---
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
  - id: j
    kind: join
  - id: rep
    kind: report
edges:
  - from: seed
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
  - from: dec
    to: j.in
  - from: dec
    to: rep.in
---
`

function newWorkspace(): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-node-chat-'))
  process.env.WORKSPACE_PATH = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('chains/held.md', chain)
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

async function startRun(): Promise<string> {
  const { POST } = await import('../app/api/run/route')
  const events = await sse(await POST({ json: async () => ({ chainName: 'held', seedPrompt: 'go' }) } as import('next/server').NextRequest))
  assert.strictEqual(events.at(-1)!.type, 'run_waiting')
  return events.at(-1)!.runId as string
}

async function chat(runId: string, nodeId: string, body: object): Promise<Response> {
  const { POST } = await import('../app/api/runs/[runId]/nodes/[nodeId]/chat/route')
  return POST(
    { json: async () => body } as import('next/server').NextRequest,
    { params: Promise.resolve({ runId, nodeId }) },
  )
}

async function readMeta(runId: string): Promise<RunMeta> {
  const { readRunMeta } = await import('../lib/logger')
  return readRunMeta(runId)
}

const decLog = (wp: string, runId: string) =>
  matter(fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8'))

test('chat streams tokens and ends with the full reply', async () => {
  newWorkspace()
  const runId = await startRun()

  const events = await sse(await chat(runId, 'dec', { message: 'why candidate 1?' }))

  assert.deepStrictEqual(events.filter(e => e.type === 'token').map(e => [e.token, e.tokenType]), [['hmm', 'thought'], ['reply 1', 'output']])
  const done = events.at(-1)!
  assert.strictEqual(done.type, 'chat_done')
  assert.deepStrictEqual(done.message, { role: 'assistant', content: 'reply 1', thought: 'hmm' })
})

test('each turn continues the transcript: system, input, output, earlier turns; thought never replayed', async () => {
  newWorkspace()
  const runId = await startRun()
  const dec = (await readMeta(runId)).agentOutputs.find(o => o.nodeId === 'dec')!

  for (const message of ['one', 'two', 'three']) await sse(await chat(runId, 'dec', { message }))

  assert.deepStrictEqual(chats[0], [
    { role: 'system', content: dec.systemPrompt },
    { role: 'user', content: dec.input },
    { role: 'assistant', content: dec.output },
    { role: 'user', content: 'one' },
  ])
  assert.deepStrictEqual(chats[2].slice(3), [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'reply 1' },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: 'reply 2' },
    { role: 'user', content: 'three' },
  ])

  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'waiting', 'chat never touches the run status')
  const record = meta.agentOutputs.find(o => o.nodeId === 'dec')!
  assert.strictEqual(record.output, dec.output, 'a reply does not replace the output')
  assert.deepStrictEqual(record.conversation?.map(m => [m.role, m.content]), [
    ['user', 'one'], ['assistant', 'reply 1'],
    ['user', 'two'], ['assistant', 'reply 2'],
    ['user', 'three'], ['assistant', 'reply 3'],
  ])
})

test('the node log gains ## Conversation after ## Output, one human/agent pair per turn', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  const before = decLog(wp, runId)
  const files = fs.readdirSync(path.join(wp, 'logs', runId))

  await sse(await chat(runId, 'dec', { message: 'one' }))
  await sse(await chat(runId, 'dec', { message: 'two' }))

  const { data, content } = decLog(wp, runId)
  assert.deepStrictEqual(data, before.data, 'frontmatter unchanged')
  assert.ok(content.startsWith('## Output\n\n## Candidate 1\nfrom decider'))
  const convo = content.slice(content.indexOf('## Conversation'))
  assert.ok(content.indexOf('## Output') < content.indexOf('## Conversation'))
  assert.ok(convo.includes('### Turn 1\n\n**human:** one\n\n> hmm\n\n**Decider:** reply 1'))
  assert.ok(convo.includes('### Turn 2\n\n**human:** two'))
  assert.ok(convo.includes('**Decider:** reply 2'))
  assert.deepStrictEqual(fs.readdirSync(path.join(wp, 'logs', runId)), files, 'the log is rewritten, not a new step')
})

test('chat works on a complete run, and resume keeps the conversation', async () => {
  newWorkspace()
  const runId = await startRun()
  await sse(await chat(runId, 'dec', { message: 'before resume' }))

  const { POST } = await import('../app/api/runs/[runId]/resume/route')
  await sse(await POST({ json: async () => ({ direction: 'go' }) } as import('next/server').NextRequest, { params: Promise.resolve({ runId }) }))
  assert.strictEqual((await readMeta(runId)).status, 'complete')

  const events = await sse(await chat(runId, 'dec', { message: 'after resume' }))
  assert.strictEqual(events.at(-1)!.type, 'chat_done')
  const record = (await readMeta(runId)).agentOutputs.find(o => o.nodeId === 'dec')!
  assert.deepStrictEqual(record.conversation?.filter(m => m.role === 'user').map(m => m.content), ['before resume', 'after resume'])

  // A node that ran after the hold is a proposer too.
  assert.strictEqual((await sse(await chat(runId, 'after', { message: 'hi' }))).at(-1)!.type, 'chat_done')
})

test('chat to a join, report, hold, or a node with no output is refused', async () => {
  newWorkspace()
  const runId = await startRun()
  for (const nodeId of ['j', 'rep', 'hold', 'after', 'seed']) {
    assert.strictEqual((await chat(runId, nodeId, { message: 'hi' })).status, 400, nodeId)
  }
  assert.strictEqual((await chat(runId, 'dec', {})).status, 400, 'message is required')
  assert.strictEqual((await chat(runId, 'dec', { message: '  ' })).status, 400, 'message is required')
  assert.strictEqual((await chat(runId, 'nope', { message: 'hi' })).status, 404)
  assert.strictEqual((await chat('no-such-run', 'dec', { message: 'hi' })).status, 404)
  assert.strictEqual(chats.length, 0)
})

test('chat on a running run is refused, so a live stretch cannot overwrite it', async () => {
  newWorkspace()
  const runId = await startRun()
  const { updateRunMeta } = await import('../lib/logger')
  updateRunMeta(runId, { status: 'running' })
  assert.strictEqual((await chat(runId, 'dec', { message: 'hi' })).status, 409)
})

test('a tool-using proposer is replayed without its tool turns (#92), and its log keeps the Tool Loop', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  const { updateRunMeta, writeAgentLog } = await import('../lib/logger')
  const meta = await readMeta(runId)
  const toolCalls = [{ turn: 1, name: 'retrieve', args: { q: 'x' }, result: 'hit', latencyMs: 1, isError: false }]
  const agentOutputs = meta.agentOutputs.map(o => o.nodeId === 'dec' ? { ...o, toolCalls, toolTurns: 1 } : o)
  updateRunMeta(runId, { agentOutputs })
  writeAgentLog(runId, 0, agentOutputs[0])

  await sse(await chat(runId, 'dec', { message: 'one' }))

  assert.deepStrictEqual(chats[0].map(m => m.role), ['system', 'user', 'assistant', 'user'])
  const { content } = decLog(wp, runId)
  assert.ok(content.indexOf('## Tool Loop') < content.indexOf('## Output'))
  assert.ok(content.indexOf('## Output') < content.indexOf('## Conversation'))
})

test('a failed reply is reported and recorded nowhere', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  const before = fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8')

  const events = await sse(await chat(runId, 'dec', { message: 'fail' }))

  assert.deepStrictEqual(events.at(-1), { type: 'error', error: 'model down' })
  assert.strictEqual((await readMeta(runId)).agentOutputs.find(o => o.nodeId === 'dec')!.conversation, undefined)
  assert.strictEqual(fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8'), before)
})
