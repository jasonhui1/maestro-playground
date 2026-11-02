import { test, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NextRequest } from 'next/server'
import { requestEntry } from './helpers/requestWorkspace'
import { answer, fakeModel } from './helpers/fakeModel'
import { drainSse } from './helpers/contractScenarios'
import type { HoldRecord, RunMeta } from '@/lib/types'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

const fake = fakeModel(({ agentSlug }) => agentSlug === 'decider'
  ? answer('## Candidate 1\none\n\n## Candidate 2\ntwo', [10, 10])
  : answer(`from ${agentSlug}`))
requestEntry.model = fake.model

const CHAIN = `---
name: held-chain
nodes:
  - id: seed
    kind: seed
  - id: proposer
    kind: agent
    agent: proposer
  - id: decider
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: proposer.input
  - from: proposer
    to: decider.input
  - from: decider
    to: hold.in
  - from: hold
    to: after.direction
---
`

let root = ''
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-reroll-'))
  requestEntry.root = root
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }
  write('chains/held-chain.md', CHAIN)
  for (const [slug, input] of [['proposer', 'input'], ['decider', 'input'], ['after', 'direction']]) {
    write(`agents/${slug}.md`, `---\nname: ${slug}\nmodel: openai/gpt-4o-mini\n---\n${slug} on {${input}}\n`)
  }
  fake.reset()
})
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

const req = (body: unknown) => ({ json: async () => body }) as NextRequest

async function startWaiting(): Promise<string> {
  const { POST } = await import('../app/api/run/route')
  const { events } = await drainSse(await POST(req({ chainName: 'held-chain', seedPrompt: 'go' })))
  const runId = events.find(e => e.type === 'run_start')!.runId as string
  assert.strictEqual(events.at(-1)!.type, 'run_waiting')
  return runId
}

async function reroll(runId: string, body: Record<string, unknown> = {}) {
  const { POST } = await import('../app/api/runs/[runId]/holds/[holdId]/reroll/route')
  return POST(req(body), { params: Promise.resolve({ runId, holdId: 'hold' }) })
}

async function saveFeedback(runId: string, feedback: unknown) {
  const { PATCH } = await import('../app/api/runs/[runId]/holds/[holdId]/route')
  return PATCH(req({ feedback }), { params: Promise.resolve({ runId, holdId: 'hold' }) })
}

async function resume(runId: string, body: Record<string, unknown>) {
  const { POST } = await import('../app/api/runs/[runId]/resume/route')
  return POST(req(body), { params: Promise.resolve({ runId }) })
}

const meta = (runId: string): RunMeta => JSON.parse(fs.readFileSync(path.join(root, 'logs', runId, 'meta.json'), 'utf-8'))
const openHold = (runId: string): HoldRecord => meta(runId).holds!.findLast(h => !h.resolvedAt)!
const runIds = () => fs.readdirSync(path.join(root, 'logs')).sort()
const forkedId = (events: Array<Record<string, unknown>>) => events.find(e => e.type === 'run_start')!.runId as string

test('a reroll\'s run_start carries the run\'s rolls, in place and forked (#155)', async () => {
  fs.writeFileSync(path.join(root, 'agents/after.md'), '---\nname: after\nmodel: openai/gpt-4o-mini\ndice:\n  hair: [bob]\n---\nafter on {direction}\n')
  const runId = await startWaiting()
  const rolls = { after: { hair: ['bob'] } }
  assert.deepStrictEqual(meta(runId).dice, rolls)
  for (const body of [{ revision: 1 }, { fork: true, revision: 2 }]) {
    const { events } = await drainSse(await reroll(runId, body))
    assert.deepStrictEqual(events.find(e => e.type === 'run_start')!.dice, rolls, JSON.stringify(body))
  }
})

// Decisions, replay and persistence are the continuation's, tested in continue-run.test.ts; this is parse → call → respond.
test('a reroll streams fresh candidates in the same run, which waits again (#134)', async () => {
  const runId = await startWaiting()
  const { events } = await drainSse(await reroll(runId, { feedback: 'darker', revision: 1 }))
  assert.deepStrictEqual([events[0].type, events[0].runId], ['run_start', runId])
  const waiting = events.at(-1)!
  assert.deepStrictEqual([waiting.type, waiting.runId, (waiting.hold as HoldRecord).revision], ['run_waiting', runId, 2])
  assert.strictEqual(openHold(runId).feedback, 'darker')
})

test('a fork reroll streams a new run (#147)', async () => {
  const runId = await startWaiting()
  const { events } = await drainSse(await reroll(runId, { like: 'Candidate 1', revision: 1 }))
  const forkId = forkedId(events)
  assert.notStrictEqual(forkId, runId)
  assert.deepStrictEqual(runIds(), [runId, forkId].sort())
  assert.strictEqual(meta(forkId).branchedFromRunId, runId)
})

test('a body reroll cannot read is a bad request; an unknown run is not found', async () => {
  const runId = await startWaiting()
  for (const body of [{ feedback: 3 }, { revision: 'one' }, { fork: 'yes' }, { like: '  ' }, { like: 'Candidate 1', fork: false }]) {
    assert.strictEqual((await reroll(runId, body)).status, 400, JSON.stringify(body))
  }
  assert.strictEqual((await reroll('no-such-run')).status, 404)
  assert.strictEqual(meta(runId).status, 'waiting')
})

test('feedback is saved on the open hold of a waiting run; empty clears it (#134)', async () => {
  const runId = await startWaiting()
  const saved = await saveFeedback(runId, 'Less tragic')
  assert.strictEqual(saved.status, 200)
  assert.strictEqual((await saved.json()).hold.feedback, 'Less tragic')
  assert.strictEqual(openHold(runId).feedback, 'Less tragic')
  await saveFeedback(runId, '')
  assert.strictEqual(openHold(runId).feedback, undefined)
})

test('feedback needs an open hold on a waiting run', async () => {
  const runId = await startWaiting()
  await drainSse(await resume(runId, { direction: 'go' }))
  assert.strictEqual((await saveFeedback(runId, 'x')).status, 409)
  assert.strictEqual((await saveFeedback(runId, 3)).status, 400)
})
