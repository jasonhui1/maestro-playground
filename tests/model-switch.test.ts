import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import type { AgentDef, AgentOutput, ChainDef, RunMeta } from '../lib/types'
import { knownModelCatalogue, resolveContinuationModelOverride, calcCost, PRICED_MODELS } from '../lib/pricing'
import { buildRunFrame } from '../lib/runFrame'
import { emptyNodeState, RunStateMap } from '../lib/runState'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

const ranAgents: { slug: string; model: string; modelSource?: string }[] = []
vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: AgentDef, systemPrompt: string, userMessage: string): Promise<AgentOutput> => {
    ranAgents.push({
      slug: agent.slug,
      model: agent.model,
      modelSource: agent.resolution?.sources.model,
    })
    const isDecider = agent.slug === 'decider'
    const output = isDecider
      ? '## Candidate 1\noption one\n\n## Candidate 2\noption two'
      : `output from ${agent.slug}`
    return {
      agentName: agent.name,
      systemPrompt,
      input: userMessage,
      output,
      tokensIn: 100,
      tokensOut: 200,
      costUsd: calcCost(agent.model, 100, 200) ?? 0,
      latencyMs: 42,
      model: agent.model,
      modelSource: agent.resolution?.sources.model,
      timestamp: new Date().toISOString(),
      status: 'success',
    }
  },
}))

const ORIGINAL_ENV = {
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_MODEL_NAME: process.env.AI_MODEL_NAME,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  AI_MODEL_OVERRIDE: process.env.AI_MODEL_OVERRIDE,
}

const tempDirs: string[] = []

function createTempDir(prefix = 'ws-model-switch-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  ranAgents.length = 0
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

type Event = { type: string; [k: string]: unknown }
type Req = import('next/server').NextRequest

async function sse(res: Response): Promise<Event[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

function setupWorkspace(tmpDir: string, chainOverride?: string) {
  requestEntry.root = tmpDir
  const write = (rel: string, body: string) => {
    const p = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }

  const defaultChain = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: prop
    kind: agent
    agent: prop
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
  - from: prop
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`

  write('chains/held.md', chainOverride ?? defaultChain)
  write('agents/prop.md', '---\nname: Prop\nmodel: anthropic/claude-3-haiku\n---\npropose {input}\n')
  write('agents/decider.md', '---\nname: Decider\nmodel: anthropic/claude-3-haiku\n---\ndecide {input}\n')
  write('agents/after.md', '---\nname: After\nmodel: anthropic/claude-3-haiku\n---\nbuild on {direction}\n')
}

// ---------------------------------------------------------------------------
// 1. Pure functions
// ---------------------------------------------------------------------------
test('pure: knownModelCatalogue combines declared, configured, and priced models without duplicates (#128)', () => {
  const declared = ['custom/declared-model', 'openai/gpt-4o']
  const catalogue = knownModelCatalogue(declared, 'custom/configured-model')

  assert.ok(catalogue.includes('custom/declared-model'))
  assert.ok(catalogue.includes('custom/configured-model'))
  assert.ok(catalogue.includes('openai/gpt-4o'))
  for (const pm of PRICED_MODELS) {
    assert.ok(catalogue.includes(pm))
  }
  // No duplicates
  const set = new Set(catalogue)
  assert.strictEqual(catalogue.length, set.size)
})

test('pure: resolveContinuationModelOverride obeys omission, clear, and replacement rules (#128)', () => {
  // Omission (undefined) inherits
  assert.strictEqual(resolveContinuationModelOverride('source-model', undefined), 'source-model')
  // Blank string inherits
  assert.strictEqual(resolveContinuationModelOverride('source-model', ''), 'source-model')
  assert.strictEqual(resolveContinuationModelOverride('source-model', '   '), 'source-model')
  // null explicitly clears
  assert.strictEqual(resolveContinuationModelOverride('source-model', null), undefined)
  // Non-empty string replaces
  assert.strictEqual(resolveContinuationModelOverride('source-model', 'new-model'), 'new-model')
  assert.strictEqual(resolveContinuationModelOverride('source-model', '  trimmed-model  '), 'trimmed-model')
  // When source was undefined, null remains undefined and string sets it
  assert.strictEqual(resolveContinuationModelOverride(undefined, null), undefined)
  assert.strictEqual(resolveContinuationModelOverride(undefined, 'new-model'), 'new-model')
})

// ---------------------------------------------------------------------------
// 2. Request validation
// ---------------------------------------------------------------------------
test('validation: POST /api/run validates modelOverride (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST } = await import('../app/api/run/route')

  // Non-string rejected with 400
  const r1 = await POST({ json: async () => ({ chainName: 'held', modelOverride: 12345 }) } as Req)
  assert.strictEqual(r1.status, 400)
  assert.match((await r1.json()).error, /modelOverride/)

  // Empty string rejected with 400
  const r2 = await POST({ json: async () => ({ chainName: 'held', modelOverride: '   ' }) } as Req)
  assert.strictEqual(r2.status, 400)

  // Valid string accepted
  const r3 = await POST({ json: async () => ({ chainName: 'held', seedPrompt: 'hi', modelOverride: 'openai/gpt-4o' }) } as Req)
  assert.strictEqual(r3.status, 200)
})

test('validation: POST /api/runs/:runId/resume validates modelOverride (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST: runPOST } = await import('../app/api/run/route')
  const { POST: resumePOST } = await import('../app/api/runs/[runId]/resume/route')

  const events = await sse(await runPOST({ json: async () => ({ chainName: 'held', seedPrompt: 'go' }) } as Req))
  const runId = events.at(-1)!.runId as string

  // Non-string/non-null rejected with 400
  const r1 = await resumePOST({ json: async () => ({ direction: 'next', modelOverride: 999 }) } as Req, { params: Promise.resolve({ runId }) })
  assert.strictEqual(r1.status, 400)

  // Empty string rejected with 400
  const r2 = await resumePOST({ json: async () => ({ direction: 'next', modelOverride: '   ' }) } as Req, { params: Promise.resolve({ runId }) })
  assert.strictEqual(r2.status, 400)

  // Null accepted (clears)
  const r3 = await resumePOST({ json: async () => ({ direction: 'next', modelOverride: null }) } as Req, { params: Promise.resolve({ runId }) })
  assert.strictEqual(r3.status, 200)
})

test('validation: POST /api/runs/:runId/fork validates modelOverride (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST: runPOST } = await import('../app/api/run/route')
  const { POST: forkPOST } = await import('../app/api/runs/[runId]/fork/route')

  const events = await sse(await runPOST({ json: async () => ({ chainName: 'held', seedPrompt: 'go' }) } as Req))
  const runId = events.at(-1)!.runId as string

  // Non-string/non-null rejected with 400
  const r1 = await forkPOST({ json: async () => ({ from: 'prop', modelOverride: true }) } as Req, { params: Promise.resolve({ runId }) })
  assert.strictEqual(r1.status, 400)

  // Empty string rejected with 400
  const r2 = await forkPOST({ json: async () => ({ from: 'prop', modelOverride: '' }) } as Req, { params: Promise.resolve({ runId }) })
  assert.strictEqual(r2.status, 400)

  // Valid string accepted
  const r3 = await forkPOST({ json: async () => ({ from: 'prop', modelOverride: 'openai/gpt-4o' }) } as Req, { params: Promise.resolve({ runId }) })
  assert.strictEqual(r3.status, 200)
})

// ---------------------------------------------------------------------------
// 3. Fresh launch with model override
// ---------------------------------------------------------------------------
test('fresh launch: modelOverride executes override model, records meta/logs as run override, and leaves agent files untouched (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST } = await import('../app/api/run/route')

  const agentPath = path.join(tmp, 'agents', 'prop.md')
  const originalAgentBytes = fs.readFileSync(agentPath, 'utf8')

  const events = await sse(await POST({
    json: async () => ({
      chainName: 'held',
      seedPrompt: 'go',
      modelOverride: 'openai/gpt-4o',
    }),
  } as Req))

  const runId = events.at(-1)!.runId as string
  assert.ok(runId)

  // 1. Agent file on disk was completely untouched
  const currentAgentBytes = fs.readFileSync(agentPath, 'utf8')
  assert.strictEqual(currentAgentBytes, originalAgentBytes)

  // 2. Executed agents ran with the override
  assert.ok(ranAgents.length >= 2)
  for (const a of ranAgents) {
    assert.strictEqual(a.model, 'openai/gpt-4o')
    assert.strictEqual(a.modelSource, 'run override')
  }

  // 3. meta.json records modelOverride
  const metaPath = path.join(tmp, 'logs', runId, 'meta.json')
  const meta: RunMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  assert.strictEqual(meta.modelOverride, 'openai/gpt-4o')

  // Each agent output in meta records the model and modelSource
  for (const out of meta.agentOutputs) {
    assert.strictEqual(out.model, 'openai/gpt-4o')
    assert.strictEqual(out.modelSource, 'run override')
    // Cost was calculated using the overridden model price (openai/gpt-4o price > 0)
    assert.ok((out.costUsd ?? 0) > 0)
  }

  // 4. Step logs record model and model_source: run override
  const log0Path = path.join(tmp, 'logs', runId, '00-prop.md')
  const logContent = fs.readFileSync(log0Path, 'utf8')
  const parsedLog = matter(logContent)
  assert.strictEqual(parsedLog.data.model, 'openai/gpt-4o')
  assert.strictEqual(parsedLog.data.model_source, 'run override')
})

// ---------------------------------------------------------------------------
// 4. Precedence: modelOverride > AI_MODEL_OVERRIDE=true > agent file
// ---------------------------------------------------------------------------
test('precedence: request modelOverride beats AI_MODEL_OVERRIDE=true (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST } = await import('../app/api/run/route')

  process.env.AI_PROVIDER = 'google'
  process.env.AI_MODEL_NAME = 'google/gemini-2.5-flash'
  process.env.AI_MODEL_OVERRIDE = 'true'

  // With explicit request override, request override wins over env override
  ranAgents.length = 0
  await sse(await POST({
    json: async () => ({
      chainName: 'held',
      seedPrompt: 'go',
      modelOverride: 'openai/gpt-4o',
    }),
  } as Req))

  assert.ok(ranAgents.length >= 2)
  for (const a of ranAgents) {
    assert.strictEqual(a.model, 'openai/gpt-4o')
    assert.strictEqual(a.modelSource, 'run override')
  }

  // Without request override, env override wins
  ranAgents.length = 0
  await sse(await POST({
    json: async () => ({
      chainName: 'held',
      seedPrompt: 'go',
    }),
  } as Req))

  assert.ok(ranAgents.length >= 2)
  for (const a of ranAgents) {
    assert.strictEqual(a.model, 'google/gemini-2.5-flash')
    assert.strictEqual(a.modelSource, 'env override')
  }
})

// ---------------------------------------------------------------------------
// 5. Inheritance across resume and fork
// ---------------------------------------------------------------------------
test('continuation inheritance: resume inherits source override when omitted, replaces when specified (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST: runPOST } = await import('../app/api/run/route')
  const { POST: resumePOST } = await import('../app/api/runs/[runId]/resume/route')

  // Launch held run with modelOverride
  const events = await sse(await runPOST({
    json: async () => ({ chainName: 'held', seedPrompt: 'go', modelOverride: 'openai/gpt-4o' }),
  } as Req))
  const runId = events.at(-1)!.runId as string

  // 1. Resume with omitted modelOverride -> inherits 'openai/gpt-4o'
  ranAgents.length = 0
  await sse(await resumePOST({
    json: async () => ({ direction: 'proceed' }),
  } as Req, { params: Promise.resolve({ runId }) }))

  // The downstream node 'after' ran with inherited override
  const afterRun = ranAgents.find(a => a.slug === 'after')
  assert.ok(afterRun)
  assert.strictEqual(afterRun.model, 'openai/gpt-4o')
  assert.strictEqual(afterRun.modelSource, 'run override')

  const metaPath = path.join(tmp, 'logs', runId, 'meta.json')
  const meta: RunMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  assert.strictEqual(meta.modelOverride, 'openai/gpt-4o')
})

test('continuation inheritance: fork with null clears override; fork with new model replaces (#128)', async () => {
  const tmp = createTempDir()
  setupWorkspace(tmp)
  const { POST: runPOST } = await import('../app/api/run/route')
  const { POST: forkPOST } = await import('../app/api/runs/[runId]/fork/route')

  // Run with modelOverride
  const events = await sse(await runPOST({
    json: async () => ({ chainName: 'held', seedPrompt: 'go', modelOverride: 'openai/gpt-4o' }),
  } as Req))
  const sourceRunId = events.at(-1)!.runId as string

  // 1. Fork with modelOverride: null (clears override back to agent declaration)
  ranAgents.length = 0
  const forkNullEvents = await sse(await forkPOST({
    json: async () => ({ from: 'dec', modelOverride: null }),
  } as Req, { params: Promise.resolve({ runId: sourceRunId }) }))
  const forkNullRunId = forkNullEvents.at(-1)!.runId as string

  // Regenerated decider ran with agent's declared model ('anthropic/claude-3-haiku') with source 'file'
  const decRun = ranAgents.find(a => a.slug === 'decider')
  assert.ok(decRun)
  assert.strictEqual(decRun.model, 'anthropic/claude-3-haiku')
  assert.strictEqual(decRun.modelSource, 'file')

  const metaNullPath = path.join(tmp, 'logs', forkNullRunId, 'meta.json')
  const metaNull: RunMeta = JSON.parse(fs.readFileSync(metaNullPath, 'utf8'))
  assert.strictEqual(metaNull.modelOverride, undefined)

  // Replayed node 'prop' retains its original model 'openai/gpt-4o' from the source run
  const propOutput = metaNull.agentOutputs.find(o => o.nodeId === 'prop')
  assert.ok(propOutput)
  assert.strictEqual(propOutput.model, 'openai/gpt-4o')

  // 2. Fork with new modelOverride replaces override
  ranAgents.length = 0
  const forkReplaceEvents = await sse(await forkPOST({
    json: async () => ({ from: 'dec', modelOverride: 'meta-llama/llama-3-70b-instruct' }),
  } as Req, { params: Promise.resolve({ runId: sourceRunId }) }))
  const forkReplaceRunId = forkReplaceEvents.at(-1)!.runId as string

  const decReplace = ranAgents.find(a => a.slug === 'decider')
  assert.ok(decReplace)
  assert.strictEqual(decReplace.model, 'meta-llama/llama-3-70b-instruct')
  assert.strictEqual(decReplace.modelSource, 'run override')

  const metaReplacePath = path.join(tmp, 'logs', forkReplaceRunId, 'meta.json')
  const metaReplace: RunMeta = JSON.parse(fs.readFileSync(metaReplacePath, 'utf8'))
  assert.strictEqual(metaReplace.modelOverride, 'meta-llama/llama-3-70b-instruct')
})

// ---------------------------------------------------------------------------
// 6. Subchain propagation
// ---------------------------------------------------------------------------
test('subchain: modelOverride propagates to agents inside subchains (#128)', async () => {
  const tmp = createTempDir()
  const chainWithSubchain = `---
name: parent
nodes:
  - id: seed
    kind: seed
  - id: sub
    kind: subchain
    subchain: child
edges:
  - from: seed
    to: sub.input
---
`
  const childChain = `---
name: child
inputs:
  - name: input
    node: inner_seed
nodes:
  - id: inner_seed
    kind: seed
  - id: worker
    kind: agent
    agent: prop
edges:
  - from: inner_seed
    to: worker.input
outputs:
  - name: out
    node: worker
---
`
  setupWorkspace(tmp, chainWithSubchain)
  fs.writeFileSync(path.join(tmp, 'chains', 'child.md'), childChain)

  const { POST } = await import('../app/api/run/route')
  ranAgents.length = 0

  await sse(await POST({
    json: async () => ({
      chainName: 'parent',
      seedPrompt: 'run child',
      modelOverride: 'openai/gpt-4o',
    }),
  } as Req))

  const worker = ranAgents.find(a => a.slug === 'prop')
  assert.ok(worker)
  assert.strictEqual(worker.model, 'openai/gpt-4o')
  assert.strictEqual(worker.modelSource, 'run override')
})

// ---------------------------------------------------------------------------
// 7. RunFrame projection
// ---------------------------------------------------------------------------
test('run frame: pre-populates override model before outputs arrive and handles unpriced models (#128)', () => {
  const chainDef: ChainDef = {
    slug: 'held', name: 'held', description: '', nodes: [], edges: [], filePath: '', isFavorite: false,
  }

  // Pre-execution frame shows model: X (override) even with empty states
  const preFrame = buildRunFrame({
    chain: chainDef,
    seed: { kind: 'paste' },
    states: {},
    now: 0,
    modelOverride: 'openai/gpt-4o',
    status: 'running',
  })

  assert.deepStrictEqual(preFrame.models, [
    { model: 'openai/gpt-4o', source: 'run override' },
  ])
  assert.strictEqual(preFrame.status, 'running')

  // Waiting run status is preserved
  const waitingFrame = buildRunFrame({
    chain: chainDef,
    seed: { kind: 'paste' },
    states: {},
    now: 0,
    modelOverride: 'openai/gpt-4o',
    status: 'waiting',
  })
  assert.strictEqual(waitingFrame.status, 'waiting')

  // Unpriced model override emits pricing warning
  const unpricedFrame = buildRunFrame({
    chain: chainDef,
    seed: { kind: 'paste' },
    states: {},
    now: 0,
    modelOverride: 'my-org/unpriced-custom-model',
  })
  assert.ok(unpricedFrame.costWarning?.includes('my-org/unpriced-custom-model'))
})
