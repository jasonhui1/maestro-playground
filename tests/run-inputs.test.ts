import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentOutput, RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

// The model is the only stand-in: the executor, route and log read-back are real. Echoing
// the resolved system prompt back as output lets a test read off which values landed where.
const ran: string[] = []
vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: { slug: string; name: string }, systemPrompt: string): Promise<AgentOutput> => {
    ran.push(agent.slug)
    return {
      agentName: agent.name, systemPrompt, input: '', output: systemPrompt,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: new Date().toISOString(), status: 'success',
    }
  },
}))

afterEach(() => {
  ran.length = 0
})

const writerChain = `---
name: writer-chain
nodes:
  - id: story-seed
    kind: seed
  - id: audience-seed
    kind: seed
  - id: writer
    kind: agent
    agent: rewriter
edges:
  - from: story-seed
    to: writer.story
  - from: audience-seed
    to: writer.audience
inputs:
  - name: story
    node: story-seed
  - name: audience
    node: audience-seed
---
`

function newWorkspace(): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-inputs-'))
  requestEntry.root = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('chains/writer-chain.md', writerChain)
  write('agents/rewriter.md', '---\nname: Rewriter\n---\nStory: {story} / Audience: {audience}\n')
  return wp
}

async function run(body: object): Promise<Response> {
  const { POST } = await import('../app/api/run/route')
  return POST({ json: async () => body } as import('next/server').NextRequest)
}

async function sse(res: Response): Promise<{ type: string; [k: string]: unknown }[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

const writerDone = (events: { type: string; [k: string]: unknown }[]) =>
  events.find(e => e.type === 'agent_done' && e.nodeId === 'writer')!.output as AgentOutput

test('a named input fills the seed its port binds to', async () => {
  newWorkspace()
  const events = await sse(await run({ chainName: 'writer-chain', seedPrompt: 'SEED', inputs: { story: 'a knight', audience: 'kids' } }))
  assert.strictEqual(writerDone(events).output, 'Story: a knight / Audience: kids')
})

test('an input left out falls back to seedPrompt', async () => {
  newWorkspace()
  const events = await sse(await run({ chainName: 'writer-chain', seedPrompt: 'FALLBACK', inputs: { story: 'a knight' } }))
  assert.strictEqual(writerDone(events).output, 'Story: a knight / Audience: FALLBACK')
})

test('a chain with no inputs given behaves exactly as a seedPrompt-only run', async () => {
  newWorkspace()
  const events = await sse(await run({ chainName: 'writer-chain', seedPrompt: 'SEED' }))
  assert.strictEqual(writerDone(events).output, 'Story: SEED / Audience: SEED')
})

test('an input name the chain does not declare is a 400 naming it', async () => {
  newWorkspace()
  const res = await run({ chainName: 'writer-chain', seedPrompt: 'SEED', inputs: { bogus: 'x' } })
  assert.strictEqual(res.status, 400)
  const body = await res.json() as { error: string }
  assert.match(body.error, /bogus/)
})

test('the values are pinned with the run: they land as records a resume or fork can replay', async () => {
  const wp = newWorkspace()
  const runId = (await sse(await run({ chainName: 'writer-chain', seedPrompt: 'SEED', inputs: { story: 'a knight', audience: 'kids' } }))).at(-1)!.runId as string

  const { GET } = await import('../app/api/runs/[runId]/route')
  const meta = await (await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId }) })).json() as RunMeta
  const storyRecord = meta.agentOutputs.find(o => o.nodeId === 'story-seed')
  const audienceRecord = meta.agentOutputs.find(o => o.nodeId === 'audience-seed')
  assert.strictEqual(storyRecord?.output, 'a knight')
  assert.strictEqual(audienceRecord?.output, 'kids')
  void wp
})
