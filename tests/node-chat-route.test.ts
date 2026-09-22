import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { ChatMessage, RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'
import { answer, callRetrieve, fakeModel, retrieveToolFile, tavernsContextFile } from './helpers/fakeModel'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

// A node's own turn arrives as the executor's two-message opener; a chat turn as
// the node's transcript, which is what these arrays collect.
const chats: ChatMessage[][] = []
const chatModels: string[] = []
const chatTools: string[][] = []
let duringAfter: (() => void) | undefined
const fake = fakeModel(({ last, tools, messages, model, agentSlug, hooks }) => {
  if (messages.length === 2) {
    if (agentSlug === 'after') duringAfter?.()
    return answer(`## Candidate 1\nfrom ${agentSlug}`)
  }
  chats.push(messages.map(m => ({ role: m.role, content: m.content }) as ChatMessage))
  chatModels.push(model)
  chatTools.push(tools)
  if (last.content === 'fail') throw new Error('model down')
  if (tools.length > 0) return callRetrieve('Gilded Flagon', hooks)
  const n = messages.filter(m => m.role === 'user').length - 1
  hooks?.onToken?.('hmm', 'thought')
  hooks?.onToken?.(`reply ${n}`, 'output')
  return answer(`<thought>hmm</thought>reply ${n}`)
})
vi.mock('@/lib/chatCall', () => ({ createChatCall: fake.createChatCall }))

afterEach(() => {
  chats.length = 0
  chatModels.length = 0
  chatTools.length = 0
  duringAfter = undefined
  fake.reset()
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
  requestEntry.root = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('chains/held.md', chain)
  write('agents/decider.md', '---\nname: Decider\nmodel: m\n---\ndecide {input}\n')
  write('agents/after.md', '---\nname: After\nmodel: m\n---\nbuild on {direction}\n')
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
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root)
  return runs.read(runId)
}

const decLog = (wp: string, runId: string) =>
  matter(fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8'))

test('chat streams tokens and ends with the full reply', async () => {
  newWorkspace()
  const runId = await startRun()

  const events = await sse(await chat(runId, 'dec', { message: 'why candidate 1?' }))

  assert.strictEqual(events.some(e => e.type.startsWith('tool_')), false, 'a tool-less agent stream has no tool events (#140)')
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
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root)
  runs.update(runId, { status: 'running' })
  assert.strictEqual((await chat(runId, 'dec', { message: 'hi' })).status, 409)
})

test('a tool-using proposer is replayed without its tool turns (#92), and its log keeps the Tool Loop', async () => {
  const wp = newWorkspace()
  const runId = await startRun()
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root)
  const meta = await readMeta(runId)
  const toolCalls = [{ turn: 1, name: 'retrieve', args: { q: 'x' }, result: 'hit', latencyMs: 1, isError: false }]
  const agentOutputs = meta.agentOutputs.map(o => o.nodeId === 'dec' ? { ...o, toolCalls, toolTurns: 1 } : o)
  runs.update(runId, { agentOutputs })
  runs.writeStep(runId, 0, agentOutputs[0])

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

  assert.strictEqual(events.at(-1)!.type, 'error')
  assert.match(events.at(-1)!.error as string, /model down/)
  assert.strictEqual((await readMeta(runId)).agentOutputs.find(o => o.nodeId === 'dec')!.conversation, undefined)
  assert.strictEqual(fs.readFileSync(path.join(wp, 'logs', runId, '00-dec.md'), 'utf-8'), before)
})

test('a turn written while a resume runs survives the resume ending', async () => {
  newWorkspace()
  const runId = await startRun()
  const { appendTurn } = await import('../lib/nodeChat')
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root)
  duringAfter = () => appendTurn(runs, runId, 'dec', 'mid-resume', { role: 'assistant', content: 'still here' })

  const { POST } = await import('../app/api/runs/[runId]/resume/route')
  await sse(await POST({ json: async () => ({ direction: 'go' }) } as import('next/server').NextRequest, { params: Promise.resolve({ runId }) }))

  const meta = await readMeta(runId)
  assert.strictEqual(meta.status, 'complete')
  assert.deepStrictEqual(meta.agentOutputs.find(o => o.nodeId === 'dec')!.conversation?.map(m => m.content), ['mid-resume', 'still here'])
})

test('a node whose latest record failed is refused, so the log and record never disagree', async () => {
  newWorkspace()
  const runId = await startRun()
  const { runs } = (await import('../lib/runFolders')).diskWorkspace(requestEntry.root)
  const meta = await readMeta(runId)
  const dec = meta.agentOutputs.find(o => o.nodeId === 'dec')!
  runs.update(runId, { agentOutputs: [...meta.agentOutputs, { ...dec, status: 'error', output: '' }] })
  assert.strictEqual((await chat(runId, 'dec', { message: 'hi' })).status, 400)
})

test('the reply comes from the model that wrote the output', async () => {
  newWorkspace()
  const runId = await startRun()
  await sse(await chat(runId, 'dec', { message: 'hi' }))
  assert.deepStrictEqual(chatModels, ['m'])
})

test('a chat turn gets the tools the agent file declares, and they really run (#112)', async () => {
  const wp = newWorkspace()
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(wp, rel)), { recursive: true })
    fs.writeFileSync(path.join(wp, rel), body)
  }
  write('tools/retrieve.md', retrieveToolFile)
  write('agents/decider.md', '---\nname: Decider\nmodel: m\ntools:\n  - retrieve\n---\ndecide {input}\n')
  write('context/taverns.md', tavernsContextFile)
  const runId = await startRun()

  const events = await sse(await chat(runId, 'dec', { message: 'who owns the Gilded Flagon?' }))

  assert.deepStrictEqual(chatTools.at(-1), ['retrieve'], 'the chat turn declares the tools the agent file names')
  assert.deepStrictEqual(
    events.map(e => e.type),
    ['tool_pending', 'tool_call', 'tool_result', 'token', 'chat_done'],
    'tool events are forwarded in order before token and chat_done (#140)',
  )
  const pending = events[0]
  assert.strictEqual(pending.turn, 1)
  const call = events[1]
  assert.strictEqual(call.name, 'retrieve')
  assert.strictEqual(call.turn, 1)
  const res = events[2]
  assert.strictEqual(res.name, 'retrieve')
  assert.strictEqual(res.turn, 1)
  assert.strictEqual(res.isError, false)
  assert.match(res.result as string, /Mirna Copperhand/)
  const token = events[3]
  assert.match(token.token as string, /Mirna Copperhand/)

  const done = events.at(-1)!
  assert.strictEqual(done.type, 'chat_done')
  assert.match((done.message as ChatMessage).content, /Mirna Copperhand/, 'the tool ran against the workspace')
})
