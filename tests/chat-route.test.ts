import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'
import { answer, callRetrieve, fakeModel, retrieveToolFile, tavernsContextFile } from './helpers/fakeModel'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

const model = fakeModel(({ last, tools, hooks }) => {
  if (last.content === 'fail') throw new Error('model down')
  if (tools.length > 0) return callRetrieve('Gilded Flagon')
  hooks?.onToken?.('weighing', 'thought')
  hooks?.onToken?.('Mirna owns it.', 'output')
  return answer('<thought>weighing</thought>Mirna owns it.', [30, 7])
})
vi.mock('@/lib/chatCall', () => ({ createChatCall: model.createChatCall }))

const seen = model.seen
const roles = (i: number) => seen[i].messages.map(m => m.role)

afterEach(() => model.reset())

function write(wp: string, rel: string, body: string) {
  fs.mkdirSync(path.dirname(path.join(wp, rel)), { recursive: true })
  fs.writeFileSync(path.join(wp, rel), body)
}

function newWorkspace(agentFrontmatter = 'name: Lore Keeper\nmodel: m'): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-chat-route-'))
  requestEntry.root = wp
  write(wp, 'agents/lore-keeper.md', `---\n${agentFrontmatter}\n---\nanswer {input}\n`)
  return wp
}

type Event = { type: string; [k: string]: unknown }

async function post(body: object): Promise<Response> {
  const { POST } = await import('../app/api/chat/route')
  return POST({ json: async () => body } as import('next/server').NextRequest)
}

async function sse(res: Response): Promise<Event[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

const readMeta = async (runId: string): Promise<RunMeta> =>
  (await import('../lib/runFolders')).diskWorkspace(requestEntry.root).runs.read(runId)

test('a chat turn streams tokens, splits the thought, and lands in the run', async () => {
  newWorkspace()

  const events = await sse(await post({ agentName: 'Lore Keeper', messages: [{ role: 'user', content: 'who owns the Gilded Flagon?' }] }))

  assert.strictEqual(events[0].type, 'run_id')
  assert.deepStrictEqual(
    events.filter(e => e.type === 'token').map(e => [e.token, e.tokenType]),
    [['weighing', 'thought'], ['Mirna owns it.', 'output']],
  )
  const done = events.at(-1) as { type: string; runId: string; result: { output: string; thought?: string; tokensIn: number } }
  assert.strictEqual(done.type, 'done')
  assert.strictEqual(done.result.output, 'Mirna owns it.')
  assert.strictEqual(done.result.thought, 'weighing')
  assert.strictEqual(done.result.tokensIn, 30, 'usage is reported on a tool-less turn too')

  const meta = await readMeta(done.runId)
  assert.strictEqual(meta.status, 'complete')
  assert.strictEqual(meta.agentOutputs.length, 1)
  assert.deepStrictEqual(roles(0), ['system', 'user'], 'the system prompt leads the transcript')
  assert.deepStrictEqual(seen[0].tools, [], 'an agent that declares no tools sends none')
  assert.strictEqual(seen[0].model, 'm')
})

test('a chat turn gets the tools the agent file declares, and they really run (#112)', async () => {
  const wp = newWorkspace('name: Lore Keeper\nmodel: m\ntools:\n  - retrieve')
  write(wp, 'tools/retrieve.md', retrieveToolFile)
  write(wp, 'context/taverns.md', tavernsContextFile)

  const events = await sse(await post({ agentName: 'Lore Keeper', messages: [{ role: 'user', content: 'who owns it?' }] }))

  assert.deepStrictEqual(seen[0].tools, ['retrieve'])
  const done = events.at(-1) as { type: string; result: { output: string; toolCalls?: unknown[] } }
  assert.strictEqual(done.type, 'done')
  assert.match(done.result.output, /Mirna Copperhand/, 'the tool ran against the workspace')
  assert.strictEqual(done.result.toolCalls?.length, 1, 'the transcript is kept on the record')
})

test('a failed turn is reported as a failed record, not a thrown route', async () => {
  newWorkspace()

  const events = await sse(await post({ agentName: 'Lore Keeper', messages: [{ role: 'user', content: 'fail' }] }))

  const done = events.at(-1) as { type: string; result: { status: string; output: string; error?: string } }
  assert.strictEqual(done.type, 'done')
  assert.strictEqual(done.result.status, 'error')
  assert.strictEqual(done.result.output, '')
  assert.match(done.result.error!, /model down/)
})

test('a turn continues an existing run rather than starting a new one', async () => {
  newWorkspace()
  const first = await sse(await post({ agentName: 'Lore Keeper', messages: [{ role: 'user', content: 'one' }] }))
  const runId = first[0].runId as string

  const second = await sse(await post({
    agentName: 'Lore Keeper',
    runId,
    messages: [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'Mirna owns it.' }, { role: 'user', content: 'two' }],
  }))

  assert.strictEqual(second[0].runId as string, runId)
  assert.deepStrictEqual(roles(1), ['system', 'user', 'assistant', 'user'])
  assert.strictEqual((await readMeta(runId)).agentOutputs.length, 2)
})

test('a missing agent or an empty message list is refused before any model call', async () => {
  newWorkspace()
  assert.strictEqual((await post({ messages: [{ role: 'user', content: 'hi' }] })).status, 400)
  assert.strictEqual((await post({ agentName: 'Lore Keeper', messages: [] })).status, 400)
  assert.strictEqual((await post({ agentName: 'nobody', messages: [{ role: 'user', content: 'hi' }] })).status, 404)
  assert.strictEqual(seen.length, 0)
})
