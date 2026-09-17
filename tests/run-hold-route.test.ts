import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentOutput, RunMeta } from '../lib/types'

// The model is the only stand-in: the executor, route, logger and run-read routes are real.
const ran: string[] = []
vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: { slug: string; name: string }, systemPrompt: string): Promise<AgentOutput> => {
    ran.push(agent.slug)
    return {
      agentName: agent.name, systemPrompt, input: '', output: '## Candidate 1\nkeep it\n\n## Candidate 2\ncut it',
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

const heldChain = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
    prompt: pick one
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

function newWorkspace(): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-hold-'))
  process.env.WORKSPACE_PATH = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('chains/held.md', heldChain)
  write('agents/decider.md', '---\nname: Decider\n---\ndecide {input}\n')
  write('agents/after.md', '---\nname: After\n---\nbuild on {direction}\n')
  return wp
}

async function run(body: object): Promise<{ type: string; [k: string]: unknown }[]> {
  const { POST } = await import('../app/api/run/route')
  const res = await POST({ json: async () => body } as import('next/server').NextRequest)
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

test('a run reaching a hold ends waiting, with a hold record, and nothing after the hold', async () => {
  const wp = newWorkspace()
  const events = await run({ chainName: 'held', seedPrompt: 'go' })

  const last = events.at(-1)!
  assert.strictEqual(last.type, 'run_waiting')
  assert.ok(!events.some(e => e.type === 'run_complete'))
  const runId = last.runId as string
  assert.strictEqual(last.nodeId, 'hold')
  assert.deepStrictEqual(ran, ['decider'], 'nothing after the hold executed')

  const logs = fs.readdirSync(path.join(wp, 'logs', runId))
  assert.ok(logs.some(f => f.endsWith('-dec.md')))
  assert.ok(!logs.some(f => f.endsWith('-after.md') || f.endsWith('-hold.md')), `no log after the hold: ${logs}`)

  // A fresh read from disk is what a restarted server would see.
  const { GET } = await import('../app/api/runs/[runId]/route')
  const meta = await (await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId }) })).json() as RunMeta
  assert.strictEqual(meta.status, 'waiting')
  assert.strictEqual(meta.completedAt, undefined)
  assert.deepStrictEqual(meta.agentOutputs.map(o => o.nodeId), ['dec'])
  assert.strictEqual(meta.holds?.length, 1)
  const hold = meta.holds![0]
  assert.deepStrictEqual(last.hold, hold, 'the event carries the stored record')
  assert.strictEqual(hold.nodeId, 'hold')
  assert.strictEqual(hold.prompt, 'pick one')
  assert.strictEqual(hold.input, '## Candidate 1\nkeep it\n\n## Candidate 2\ncut it')
  assert.deepStrictEqual(hold.candidates.map(c => c.heading), ['Candidate 1', 'Candidate 2'])

  const { GET: list } = await import('../app/api/runs/route')
  const waiting = await (await list({ url: 'http://x/api/runs?status=waiting' } as import('next/server').NextRequest)).json() as RunMeta[]
  assert.deepStrictEqual(waiting.map(r => r.runId), [runId])
})

test('a run replayed with the hold answered does not pause', async () => {
  newWorkspace()
  const out = (nodeId: string, output: string): AgentOutput => ({
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  })
  const events = await run({
    chainName: 'held', seedPrompt: 'go',
    branchOutputs: [out('dec', '## Candidate 1\nkeep it'), out('hold', 'KEEP: it')],
  })

  assert.strictEqual(events.at(-1)!.type, 'run_complete')
  assert.ok(!events.some(e => e.type === 'run_waiting'))
  assert.deepStrictEqual(ran, ['after'])
})
