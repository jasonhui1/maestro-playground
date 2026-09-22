import { beforeEach, test, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import type { AgentOutput, RunMeta } from '../lib/types'
import { streamRun } from '../lib/runStream'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

const ids = ['variance-run-1', 'variance-run-2', 'variance-run-3']
let nextId = 0
let afterFirstInput: (() => void) | undefined
vi.mock('@/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/logger')>()
  return { ...actual, newRunId: () => ids[nextId++] }
})

vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: { name: string; model: string }, systemPrompt: string, input: string): Promise<AgentOutput> => {
    const mutate = afterFirstInput
    afterFirstInput = undefined
    mutate?.()
    return {
      agentName: agent.name,
      systemPrompt,
      input,
      output: `answer ${nextId}`,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.01,
      latencyMs: 10,
      model: agent.model,
      timestamp: '2026-09-22T10:00:00.000Z',
      status: 'success',
    }
  },
}))

function write(root: string, rel: string, body: string) {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body)
}

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-variance-'))
  requestEntry.root = root
  write(root, 'agents/writer.md', '---\nname: Writer\nmodel: model\n---\nWrite {input}\n')
  write(root, 'context/fact.md', '---\nname: Fact\n---\noriginal context\n')
  write(root, 'chains/relay.md', `---
name: relay
nodes:
  - id: fact
    kind: context
    file: fact
  - id: writer
    kind: agent
    agent: writer
edges:
  - from: fact
    to: writer.input
---
`)
  return root
}

function storedRun(groupId: string, index: number, output: string): RunMeta {
  return {
    runId: `${groupId}-${index}`,
    chainName: 'relay',
    seedPrompt: 'same seed',
    startedAt: `2026-09-22T10:00:0${index}.000Z`,
    completedAt: `2026-09-22T10:01:0${index}.000Z`,
    status: 'complete',
    variance: { groupId, index, size: 2 },
    agentOutputs: [{
      nodeId: 'writer', agentName: 'Writer', systemPrompt: '', input: '', output,
      tokensIn: 10, tokensOut: 10, costUsd: 0.01, latencyMs: 10, model: 'model',
      timestamp: '', status: 'success',
    }],
  }
}

beforeEach(() => {
  nextId = 0
  afterFirstInput = undefined
})

test('POST /api/variance launches ordinary runs with one group id and identical pins', async () => {
  const root = workspace()
  afterFirstInput = () => write(root, 'context/fact.md', '---\nname: Fact\n---\nchanged during group\n')
  const { POST } = await import('../app/api/variance/route')
  const response = await POST({
    json: async () => ({ chainName: 'relay', chainSlug: 'relay', seedPrompt: 'same seed', count: 3 }),
  } as NextRequest)

  assert.strictEqual(response.status, 200)
  const events: Array<Record<string, unknown>> = []
  await streamRun(response.body!.getReader(), event => events.push(event as Record<string, unknown>))

  const complete = events.at(-1)
  assert.strictEqual(complete?.type, 'variance_complete')
  const groupId = complete?.groupId as string
  assert.ok(groupId)
  assert.deepStrictEqual(complete?.runIds, ids)

  const metas = ids.map(id => JSON.parse(fs.readFileSync(path.join(root, 'logs', id, 'meta.json'), 'utf8')) as RunMeta)
  assert.deepStrictEqual(metas.map(meta => meta.variance), [
    { groupId, index: 0, size: 3 },
    { groupId, index: 1, size: 3 },
    { groupId, index: 2, size: 3 },
  ])
  assert.ok(metas.every(meta => meta.seedPrompt === 'same seed'))
  assert.deepStrictEqual(metas.map(meta => meta.versions), [metas[0].versions, metas[0].versions, metas[0].versions])
  const prompts = metas.map(meta => meta.agentOutputs.find(output => output.nodeId === 'writer')?.systemPrompt)
  assert.ok(prompts.every(prompt => prompt?.includes('original context')))
  assert.ok(prompts.every(prompt => !prompt?.includes('changed during group')))
})

test('POST /api/variance rejects more than ten runs', async () => {
  workspace()
  const { POST } = await import('../app/api/variance/route')
  const response = await POST({ json: async () => ({ count: 11 }) } as NextRequest)
  assert.strictEqual(response.status, 400)
  assert.deepStrictEqual(await response.json(), { error: 'count must be an integer from 2 to 10' })
})

test('group APIs list raw runs and return the computed summary', async () => {
  const root = workspace()
  for (const run of [storedRun('group-a', 0, 'red'), storedRun('group-a', 1, 'blue'), storedRun('group-b', 0, 'other')]) {
    write(root, `logs/${run.runId}/meta.json`, JSON.stringify(run))
  }

  const { GET: listRuns } = await import('../app/api/runs/route')
  const listed = await listRuns({ url: 'http://localhost/api/runs?varianceGroupId=group-a' } as NextRequest)
  const raw = await listed.json() as RunMeta[]
  assert.deepStrictEqual(raw.map(run => run.runId), ['group-a-1', 'group-a-0'])

  const { GET: getGroup } = await import('../app/api/variance/[groupId]/route')
  const summaryResponse = await getGroup({} as NextRequest, { params: Promise.resolve({ groupId: 'group-a' }) })
  const summary = await summaryResponse.json()
  assert.strictEqual(summary.groupId, 'group-a')
  assert.strictEqual(summary.nodes[0].spread, 1)
  assert.strictEqual(summary.costUsd, 0.02)
})

test('an unknown variance group returns JSON 404', async () => {
  workspace()
  const { GET } = await import('../app/api/variance/[groupId]/route')
  const response = await GET({} as NextRequest, { params: Promise.resolve({ groupId: 'missing' }) })
  assert.strictEqual(response.status, 404)
  assert.deepStrictEqual(await response.json(), { error: 'Variance group not found' })
})
