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

// Each decider call answers a numbered set, so a test can tell the sets apart.
let deciderCalls = 0
let deciderFails: 'throw' | 'malformed' | undefined
let deciderGate: Promise<void> | undefined
const fake = fakeModel(({ agentSlug }) => {
  if (agentSlug === 'decider') {
    deciderCalls++
    // A pending answer keeps the reroll in flight; the fake awaits whatever it is handed.
    if (deciderGate) return deciderGate.then(() => answer('## Candidate 1\nlate')) as unknown as ReturnType<typeof answer>
    if (deciderFails === 'throw') throw new Error('provider down')
    if (deciderFails === 'malformed') return answer('no sections at all', [5, 5])
    return answer(`## Candidate 1\nset ${deciderCalls} one\n\n## Candidate 2\nset ${deciderCalls} two`, [10, 10])
  }
  return answer(`from ${agentSlug}`)
})
vi.mock('@/lib/chatCall', () => ({ createChatCall: fake.createChatCall }))

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
  deciderCalls = 0
  deciderFails = undefined
  deciderGate = undefined
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
const logFiles = (runId: string) => fs.readdirSync(path.join(root, 'logs', runId)).filter(f => f.endsWith('.md')).sort()
const logText = (runId: string, file: string) => fs.readFileSync(path.join(root, 'logs', runId, file), 'utf-8')
const deciderPrompts = () => fake.seen.filter(t => t.messages[0].content?.startsWith('decider on')).map(t => t.messages[0].content ?? '')

test('reroll twice with saved feedback, then resume with a pick from the second set (#134)', async () => {
  const runId = await startWaiting()
  assert.strictEqual(openHold(runId).revision, 1)
  const proposerLog = logText(runId, '00-proposer.md')
  fake.reset()

  const saved = await saveFeedback(runId, 'Less tragic, but keep a real consequence')
  assert.strictEqual(saved.status, 200)
  assert.strictEqual((await saved.json()).hold.feedback, 'Less tragic, but keep a real consequence')

  const first = await drainSse(await reroll(runId, { revision: 1 }))
  const waiting = first.events.at(-1)!
  assert.strictEqual(waiting.type, 'run_waiting')
  assert.strictEqual((waiting.hold as HoldRecord).revision, 2)
  assert.deepStrictEqual((waiting.hold as HoldRecord).candidates.map(c => c.body), ['set 2 one', 'set 2 two'])

  const second = await drainSse(await reroll(runId, { revision: 2 }))
  assert.strictEqual(second.events.at(-1)!.type, 'run_waiting')

  // Only the decider ran, each time with the feedback once on its original prompt.
  assert.strictEqual(fake.seen.length, 2)
  const prompts = deciderPrompts()
  assert.strictEqual(prompts.length, 2)
  for (const prompt of prompts) {
    assert.strictEqual(prompt.split('Less tragic, but keep a real consequence').length, 2)
    assert.ok(prompt.startsWith('decider on from proposer'))
  }

  const after = meta(runId)
  assert.strictEqual(after.status, 'waiting')
  const hold = openHold(runId)
  assert.strictEqual(hold.revision, 3)
  assert.deepStrictEqual(hold.candidates.map(c => c.body), ['set 3 one', 'set 3 two'])
  assert.strictEqual(hold.feedback, 'Less tragic, but keep a real consequence')
  // Earlier candidates stay in the decider's logs; upstream logs are untouched.
  assert.deepStrictEqual(after.agentOutputs.map(o => o.nodeId), ['proposer', 'decider', 'decider', 'decider'])
  assert.deepStrictEqual(logFiles(runId), ['00-proposer.md', '01-decider.md', '02-decider.md', '03-decider.md'])
  assert.ok(logText(runId, '01-decider.md').includes('set 1 one'))
  assert.ok(logText(runId, '02-decider.md').includes('set 2 one'))
  assert.ok(logText(runId, '03-decider.md').includes("reroll_feedback: 'Less tragic, but keep a real consequence'"))
  assert.strictEqual(logText(runId, '00-proposer.md'), proposerLog)

  const resumed = await drainSse(await resume(runId, { chosen: 'Candidate 2', revision: 3 }))
  assert.strictEqual(resumed.events.at(-1)!.type, 'run_complete')
  const afterPrompt = fake.seen.at(-1)!.messages[0].content ?? ''
  assert.ok(afterPrompt.includes('PICK: Candidate 2\nset 3 two'), afterPrompt)
})

test('feedback: omitted keeps the saved value, empty clears it, and it reaches only the reroll prompt', async () => {
  const runId = await startWaiting()
  fake.reset()
  await drainSse(await reroll(runId, { feedback: 'darker' }))
  assert.strictEqual(openHold(runId).feedback, 'darker')
  await drainSse(await reroll(runId))
  await drainSse(await reroll(runId, { feedback: '' }))
  assert.strictEqual(openHold(runId).feedback, undefined)

  const prompts = deciderPrompts()
  assert.deepStrictEqual(prompts.map(p => p.includes('darker')), [true, true, false])
  assert.strictEqual(prompts[2], 'decider on from proposer')

  await drainSse(await resume(runId, { direction: 'go on' }))
  assert.ok(!(fake.seen.at(-1)!.messages[0].content ?? '').includes('darker'))
})

test('a failed reroll keeps the old candidates and the saved feedback, records the attempt, and leaves the run waiting', async () => {
  const runId = await startWaiting()
  const before = openHold(runId)

  for (const failure of ['throw', 'malformed'] as const) {
    deciderFails = failure
    const { events } = await drainSse(await reroll(runId, { feedback: 'kinder', revision: 1 }))
    assert.ok(events.some(e => e.type === 'reroll_failed'), failure)
    assert.strictEqual(events.at(-1)!.type, 'run_waiting')
    const hold = openHold(runId)
    assert.deepStrictEqual(hold.candidates, before.candidates)
    assert.strictEqual(hold.revision, 1)
    assert.strictEqual(hold.feedback, 'kinder')
    // The attempt is recorded, but the decider still reads as its usable output.
    const outputs = meta(runId).agentOutputs
    assert.strictEqual(outputs.at(-1)!.status, 'success')
    const attempt = outputs.at(-2)!
    assert.strictEqual(attempt.status, 'error')
    assert.deepStrictEqual(attempt.reroll, { holdId: 'hold', feedback: 'kinder' })
  }
  assert.strictEqual(meta(runId).status, 'waiting')
  // The malformed answer still spent tokens, and they are counted.
  assert.ok((meta(runId).agentOutputs.at(-2)!.costUsd ?? 0) > 0)

  deciderFails = undefined
  await drainSse(await resume(runId, { chosen: 'Candidate 1', revision: 1 }))
  assert.strictEqual(meta(runId).status, 'complete')
})

test('stale revisions are conflicts; a legacy pick is refused only once a reroll replaced the set', async () => {
  const runId = await startWaiting()
  assert.strictEqual((await reroll(runId, { revision: 2 })).status, 409)
  await drainSse(await reroll(runId, { revision: 1 }))

  assert.strictEqual((await resume(runId, { chosen: 'Candidate 2', revision: 1 })).status, 409)
  assert.strictEqual((await resume(runId, { chosen: 'Candidate 2' })).status, 409)
  assert.strictEqual((await reroll(runId, { revision: 1 })).status, 409)
  const custom = await drainSse(await resume(runId, { custom: 'my own' }))
  assert.strictEqual(custom.events.at(-1)!.type, 'run_complete')
})

test('with two open holds, reroll and feedback touch only the named one', async () => {
  fs.writeFileSync(path.join(root, 'chains/twin-chain.md'), `---
name: twin-chain
nodes:
  - id: seed
    kind: seed
  - id: decider
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: other
    kind: decider
    agent: decider
  - id: second
    kind: hold
edges:
  - from: seed
    to: decider.input
  - from: decider
    to: hold.in
  - from: seed
    to: other.input
  - from: other
    to: second.in
---
`)
  const { POST } = await import('../app/api/run/route')
  const { events } = await drainSse(await POST(req({ chainName: 'twin-chain', seedPrompt: 'go' })))
  const runId = events.find(e => e.type === 'run_start')!.runId as string
  const second = () => meta(runId).holds!.find(h => h.nodeId === 'second')!
  const before = second()

  await drainSse(await reroll(runId, { feedback: 'darker' }))
  assert.strictEqual(openHold(runId).nodeId, 'second')
  assert.strictEqual(meta(runId).holds!.find(h => h.nodeId === 'hold')!.revision, 2)
  assert.deepStrictEqual(second(), before)
  assert.strictEqual(second().feedback, undefined)
})

test('a reroll in flight claims the run: a second action is refused', async () => {
  const runId = await startWaiting()
  let release = () => {}
  deciderGate = new Promise(resolve => { release = resolve })
  const inFlight = drainSse(await reroll(runId))
  assert.strictEqual(meta(runId).status, 'running')
  assert.strictEqual((await reroll(runId)).status, 409)
  assert.strictEqual((await resume(runId, { direction: 'go' })).status, 409)
  assert.strictEqual((await saveFeedback(runId, 'x')).status, 409)
  release()
  await inFlight
  assert.strictEqual(meta(runId).status, 'waiting')
})

test('reroll and feedback need an open hold on a waiting run', async () => {
  const runId = await startWaiting()
  await drainSse(await resume(runId, { direction: 'go' }))
  assert.strictEqual((await reroll(runId)).status, 409)
  assert.strictEqual((await saveFeedback(runId, 'x')).status, 409)
  assert.strictEqual((await saveFeedback(runId, 3)).status, 400)
})
