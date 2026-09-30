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

const doneOutput = (events: { type: string; [k: string]: unknown }[], nodeId: string) =>
  events.find(e => e.type === 'agent_done' && e.nodeId === nodeId)!.output as AgentOutput
const writerDone = (events: { type: string; [k: string]: unknown }[]) => doneOutput(events, 'writer')

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

test('inputs that are not a map of text are a 400', async () => {
  newWorkspace()
  for (const inputs of ['abc', null, { story: 5 }, ['a knight']]) {
    const res = await run({ chainName: 'writer-chain', seedPrompt: 'SEED', inputs })
    assert.strictEqual(res.status, 400, JSON.stringify(inputs))
    assert.match((await res.json() as { error: string }).error, /inputs must map/)
  }
})

test('empty text is a value; null leaves the input to seedPrompt', async () => {
  newWorkspace()
  const events = await sse(await run({ chainName: 'writer-chain', seedPrompt: 'FALLBACK', inputs: { story: '', audience: null } }))
  assert.strictEqual(writerDone(events).output, 'Story:  / Audience: FALLBACK')
})

test('the values are pinned with the run: a fork replays the same inputs', async () => {
  newWorkspace()
  const runId = (await sse(await run({ chainName: 'writer-chain', seedPrompt: 'SEED', inputs: { story: 'a knight', audience: 'kids' } }))).at(-1)!.runId as string

  const { GET } = await import('../app/api/runs/[runId]/route')
  const meta = await (await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId }) })).json() as RunMeta
  assert.strictEqual(meta.agentOutputs.find(o => o.nodeId === 'story-seed')?.output, 'a knight')
  assert.strictEqual(meta.agentOutputs.find(o => o.nodeId === 'audience-seed')?.output, 'kids')

  const { POST: fork } = await import('../app/api/runs/[runId]/fork/route')
  const forked = await sse(await fork({ json: async () => ({ from: 'writer' }) } as import('next/server').NextRequest, { params: Promise.resolve({ runId }) }))
  assert.strictEqual(writerDone(forked).output, 'Story: a knight / Audience: kids')
  assert.deepStrictEqual(meta.inputs, { story: 'a knight', audience: 'kids' })

  const reseeded = await sse(await fork({ json: async () => ({ from: 'story-seed' }) } as import('next/server').NextRequest, { params: Promise.resolve({ runId }) }))
  assert.strictEqual(writerDone(reseeded).output, 'Story: a knight / Audience: kids', 'a rerun seed reads its pinned input, not seedPrompt')
})

test('the workspace chain list carries each chain\'s inputs in file order', async () => {
  newWorkspace()
  const { GET } = await import('../app/api/workspace/route')
  const { chains } = await (await GET()).json() as { chains: { slug: string; inputs?: { name: string }[] }[] }
  assert.deepStrictEqual(chains.find(c => c.slug === 'writer-chain')?.inputs?.map(p => p.name), ['story', 'audience'])
})

// #152: a direct agent run declares one input per prompt slot.
const rewriterDone = (events: { type: string; [k: string]: unknown }[]) => doneOutput(events, 'rewriter')

test('an agent run fills each named slot from its input', async () => {
  newWorkspace()
  const events = await sse(await run({ agentName: 'rewriter', seedPrompt: 'SEED', inputs: { story: 'a knight', audience: 'kids' } }))
  assert.strictEqual(rewriterDone(events).output, 'Story: a knight / Audience: kids')
})

test('an agent run reads seedPrompt for a slot left out or null; an unknown slot is a 400 naming it', async () => {
  newWorkspace()
  const events = await sse(await run({ agentName: 'rewriter', seedPrompt: 'FALLBACK', inputs: { story: 'a knight', audience: null } }))
  assert.strictEqual(rewriterDone(events).output, 'Story: a knight / Audience: FALLBACK')
  const bare = await sse(await run({ agentName: 'rewriter', seedPrompt: 'FALLBACK' }))
  assert.strictEqual(rewriterDone(bare).output, 'Story: FALLBACK / Audience: FALLBACK')

  const res = await run({ agentName: 'rewriter', seedPrompt: 'SEED', inputs: { bogus: 'x' } })
  assert.strictEqual(res.status, 400)
  assert.match((await res.json() as { error: string }).error, /no prompt slot named "bogus"/)
})

test('an agent whose prompt has no slot runs with no seed', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/plain.md'), '---\nname: Plain\n---\nJust write.\n')
  const events = await sse(await run({ agentName: 'plain' }))
  assert.strictEqual(doneOutput(events, 'plain').output, 'Just write.')
  assert.strictEqual(events.filter(e => e.type === 'agent_done').length, 1)
  assert.strictEqual(events.at(-1)?.type, 'run_complete')
  const { GET } = await import('../app/api/runs/[runId]/route')
  const meta = await (await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId: events.at(-1)!.runId as string }) })).json() as RunMeta
  assert.deepStrictEqual(meta.graph, { nodes: [{ id: 'plain', kind: 'agent', agent: 'plain' }], edges: [] })
  assert.deepStrictEqual(meta.agentOutputs.map(o => o.nodeId), ['plain'])
})

test('a slotless agent ignores a supplied seed and can rerun through a fork of its recorded graph', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/plain.md'), '---\nname: Plain\n---\nJust write.\n')
  const events = await sse(await run({ agentName: 'plain', seedPrompt: 'IGNORED' }))
  assert.strictEqual(doneOutput(events, 'plain').output, 'Just write.')
  const runId = events.at(-1)!.runId as string
  const { POST: fork } = await import('../app/api/runs/[runId]/fork/route')
  for (const versions of ['current', 'pinned']) {
    const forked = await sse(await fork({ json: async () => ({ from: 'plain', versions }) } as import('next/server').NextRequest, { params: Promise.resolve({ runId }) }))
    assert.strictEqual(doneOutput(forked, 'plain').output, 'Just write.')
    assert.strictEqual(forked.filter(e => e.type === 'agent_done').length, 1)
    assert.strictEqual(forked.at(-1)?.type, 'run_complete')
    assert.notStrictEqual(forked.at(-1)?.runId, runId)
  }
  const { GET } = await import('../app/api/runs/[runId]/route')
  const source = await (await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId }) })).json() as RunMeta
  assert.strictEqual(source.status, 'complete')
  assert.deepStrictEqual(source.agentOutputs.map(o => o.nodeId), ['plain'])
})

test('the workspace advertises slotless agent runs', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/plain.md'), '---\nname: Plain\n---\nJust write.\n')
  const { GET } = await import('../app/api/workspace/route')
  const body = await (await GET()).json() as { capabilities: Record<string, boolean>; agents: { slug: string; slots: string[] }[] }
  assert.strictEqual(body.capabilities.slotlessAgentRuns, true)
  assert.deepStrictEqual(body.agents.find(a => a.slug === 'plain')?.slots, [])
})

test('an agent whose only slot is {input} runs one seed into it, as before', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/echo.md'), '---\nname: Echo\n---\nSay {input}\n')
  const events = await sse(await run({ agentName: 'echo', seedPrompt: 'SEED' }))
  assert.strictEqual(doneOutput(events, 'echo').output, 'Say SEED')
  const { GET } = await import('../app/api/runs/[runId]/route')
  const meta = await (await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId: events.at(-1)!.runId as string }) })).json() as RunMeta
  assert.deepStrictEqual(meta.graph?.nodes, [{ id: 'seed', kind: 'seed' }, { id: 'echo', kind: 'agent', agent: 'echo' }])
  assert.deepStrictEqual(meta.graph?.edges, [{ fromNode: 'seed', fromSocket: 'output', toNode: 'echo', toSocket: 'input' }])
})

test('an agent run\'s {input} slot beside named ones keeps the default seed', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/echo.md'), '---\nname: Echo\n---\nSay {input} to {audience}\n')
  const events = await sse(await run({ agentName: 'echo', seedPrompt: 'SEED', inputs: { audience: 'kids' } }))
  assert.strictEqual(doneOutput(events, 'echo').output, 'Say SEED to kids')
})

test('a fork of an agent run from a slot\'s seed keeps its pinned input', async () => {
  newWorkspace()
  const runId = (await sse(await run({ agentName: 'rewriter', seedPrompt: 'SEED', inputs: { story: 'a knight', audience: 'kids' } }))).at(-1)!.runId as string
  const { POST: fork } = await import('../app/api/runs/[runId]/fork/route')
  const reseeded = await sse(await fork({ json: async () => ({ from: 'story-seed' }) } as import('next/server').NextRequest, { params: Promise.resolve({ runId }) }))
  assert.strictEqual(rewriterDone(reseeded).output, 'Story: a knight / Audience: kids')
})

test('the workspace agent list carries each agent\'s prompt slots', async () => {
  newWorkspace()
  const { GET } = await import('../app/api/workspace/route')
  const { agents } = await (await GET()).json() as { agents: { slug: string; slots?: string[] }[] }
  assert.deepStrictEqual(agents.find(a => a.slug === 'rewriter')?.slots, ['story', 'audience'])
})
