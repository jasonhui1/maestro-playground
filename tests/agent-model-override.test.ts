import { test, afterEach } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import matter from 'gray-matter'
import { parseAgent } from '../lib/fs/parseAgent'
import { runAgentTurn } from '../lib/agentTurn'
import { noModel } from '../lib/model'
import { stepLog } from '../lib/logger'
import { buildRunFrame } from '../lib/runFrame'
import { emptyNodeState, RunStateMap } from '../lib/runState'
import type { AgentOutput, ChainDef } from '../lib/types'
import { answer } from './helpers/fakeModel'

const ORIGINAL_ENV = {
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_MODEL_NAME: process.env.AI_MODEL_NAME,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  AI_MODEL_OVERRIDE: process.env.AI_MODEL_OVERRIDE,
}

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
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

function writeTemp(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf-8')
}

test('precedence: file model wins over env model when override is unset or false', () => {
  const tmp = createTempDir('agent-test-')
  try {
    process.env.AI_PROVIDER = 'google'
    process.env.AI_MODEL_NAME = 'google/gemini-2.5-flash'
    delete process.env.AI_MODEL_OVERRIDE

    const agentPath = path.join(tmp, 'agent.md')
    writeTemp(agentPath, '---\nname: my-agent\nmodel: file/custom-model\n---\nPrompt')

    const parsed = parseAgent(agentPath, undefined, { model: 'defaults/shared-model' })
    assert.strictEqual(parsed.model, 'file/custom-model')
    assert.strictEqual(parsed.resolution?.sources.model, 'file')

    process.env.AI_MODEL_OVERRIDE = 'false'
    const parsedFalse = parseAgent(agentPath, undefined, { model: 'defaults/shared-model' })
    assert.strictEqual(parsedFalse.model, 'file/custom-model')
    assert.strictEqual(parsedFalse.resolution?.sources.model, 'file')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('precedence: defaults.md model wins over env model when file omits model', () => {
  const tmp = createTempDir('agent-test-')
  try {
    process.env.AI_PROVIDER = 'google'
    process.env.AI_MODEL_NAME = 'google/gemini-2.5-flash'
    delete process.env.AI_MODEL_OVERRIDE

    const agentPath = path.join(tmp, 'agent.md')
    writeTemp(agentPath, '---\nname: my-agent\n---\nPrompt')

    const parsed = parseAgent(agentPath, undefined, { model: 'defaults/shared-model' })
    assert.strictEqual(parsed.model, 'defaults/shared-model')
    assert.strictEqual(parsed.resolution?.sources.model, 'defaults')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('env fallback: env model wins when file and defaults omit model', () => {
  const tmp = createTempDir('agent-test-')
  try {
    process.env.AI_PROVIDER = 'google'
    process.env.AI_MODEL_NAME = 'google/gemini-2.5-flash'
    delete process.env.AI_MODEL_OVERRIDE

    const agentPath = path.join(tmp, 'agent.md')
    writeTemp(agentPath, '---\nname: my-agent\n---\nPrompt')

    const parsed = parseAgent(agentPath, undefined, {})
    assert.strictEqual(parsed.model, 'google/gemini-2.5-flash')
    assert.strictEqual(parsed.resolution?.sources.model, 'env')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('built-in fallback: default model used when file, defaults, and env all omit model', () => {
  const tmp = createTempDir('agent-test-')
  try {
    process.env.AI_PROVIDER = 'google'
    delete process.env.AI_MODEL_NAME
    delete process.env.OPENROUTER_MODEL
    delete process.env.AI_MODEL_OVERRIDE

    const agentPath = path.join(tmp, 'agent.md')
    writeTemp(agentPath, '---\nname: my-agent\n---\nPrompt')

    const parsed = parseAgent(agentPath, undefined, {})
    assert.strictEqual(parsed.model, 'anthropic/claude-3.5-sonnet')
    assert.strictEqual(parsed.resolution?.sources.model, 'built-in')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('AI_MODEL_OVERRIDE=true: env model overrides file model with source "env override"', () => {
  const tmp = createTempDir('agent-test-')
  try {
    process.env.AI_PROVIDER = 'google'
    process.env.AI_MODEL_NAME = 'google/gemini-2.5-flash'
    process.env.AI_MODEL_OVERRIDE = 'true'

    const agentPath = path.join(tmp, 'agent.md')
    writeTemp(agentPath, '---\nname: my-agent\nmodel: file/custom-model\n---\nPrompt')

    const parsed = parseAgent(agentPath, undefined, { model: 'defaults/shared-model' })
    assert.strictEqual(parsed.model, 'google/gemini-2.5-flash')
    assert.strictEqual(parsed.resolution?.sources.model, 'env override')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('an agent turn produces AgentOutput with model and modelSource matching the resolved agent (#127)', async () => {
  const tmp = createTempDir('agent-runner-test-')
  try {
    // 1. Success execution via test seam
    const agentPath = path.join(tmp, 'writer.md')
    writeTemp(agentPath, '---\nname: writer\nmodel: file/writer-model\n---\nWrite something.')

    const parsed = parseAgent(agentPath, undefined, {})
    assert.strictEqual(parsed.model, 'file/writer-model')
    assert.strictEqual(parsed.resolution?.sources.model, 'file')

    const model = () => async () => answer('generated text', [15, 25])

    const output = await runAgentTurn(model, { agent: parsed, systemPrompt: 'sys prompt', input: 'user prompt' })

    assert.strictEqual(output.status, 'success')
    assert.strictEqual(output.model, 'file/writer-model')
    assert.strictEqual(output.modelSource, 'file')
    assert.strictEqual(output.output, 'generated text')

    // 2. Execution with AI_MODEL_OVERRIDE=true
    process.env.AI_PROVIDER = 'google'
    process.env.AI_MODEL_NAME = 'google/override-model'
    process.env.AI_MODEL_OVERRIDE = 'true'

    const overriddenAgent = parseAgent(agentPath, undefined, {})
    assert.strictEqual(overriddenAgent.model, 'google/override-model')
    assert.strictEqual(overriddenAgent.resolution?.sources.model, 'env override')

    const overriddenOutput = await runAgentTurn(model, { agent: overriddenAgent, systemPrompt: 'sys prompt', input: 'user prompt' })

    assert.strictEqual(overriddenOutput.status, 'success')
    assert.strictEqual(overriddenOutput.model, 'google/override-model')
    assert.strictEqual(overriddenOutput.modelSource, 'env override')

    // 3. Error execution preserves model and modelSource; no model wired means no provider is reached (#170)
    const errorOutput = await runAgentTurn(noModel, { agent: parsed, systemPrompt: 'sys', input: 'msg' })
    assert.strictEqual(errorOutput.status, 'error')
    assert.strictEqual(errorOutput.model, 'file/writer-model')
    assert.strictEqual(errorOutput.modelSource, 'file')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('step log frontmatter includes model and model_source', () => {
  const runId = 'test-log-run'
  const frontmatter = (step: number, output: AgentOutput) => matter(stepLog(runId, step, output).content).data

  const baseOutput: AgentOutput = {
    agentName: 'researcher',
    nodeId: 'researcher-1',
    systemPrompt: 'sys',
    input: 'hi',
    output: 'hello world',
    tokensIn: 10,
    tokensOut: 20,
    costUsd: 0.001,
    latencyMs: 120,
    model: 'anthropic/claude-3.5-sonnet',
    modelSource: 'file',
    timestamp: new Date().toISOString(),
    status: 'success',
  }

  const data = frontmatter(0, baseOutput)
  assert.strictEqual(data.model, 'anthropic/claude-3.5-sonnet')
  assert.strictEqual(data.model_source, 'file')

  // Log with env override
  const data2 = frontmatter(1, {
    ...baseOutput,
    nodeId: 'researcher-2',
    model: 'google/gemini-2.5-flash',
    modelSource: 'env override',
  })
  assert.strictEqual(data2.model, 'google/gemini-2.5-flash')
  assert.strictEqual(data2.model_source, 'env override')

  // Log without modelSource removes model_source key
  const data3 = frontmatter(2, { ...baseOutput, nodeId: 'researcher-3', modelSource: undefined })
  assert.strictEqual('model_source' in data3, false)
})

test('run frame includes models with modelSource, deduplicating identical pairs', () => {
  const chainDef: ChainDef = {
    slug: 'test-chain', name: 'Test Chain', description: 'desc',
    nodes: [], edges: [], filePath: '', isFavorite: false,
  }

  const baseOut = (model: string, modelSource?: AgentOutput['modelSource']): AgentOutput => ({
    agentName: 'a', systemPrompt: '', input: '', output: 'out',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
    model, modelSource, timestamp: '', status: 'success',
  })

  const statesMap: RunStateMap = {
    n1: { ...emptyNodeState(), status: 'success', result: baseOut('model-a', 'file') },
    n2: { ...emptyNodeState(), status: 'success', result: baseOut('model-b', 'defaults') },
    n3: { ...emptyNodeState(), status: 'success', result: baseOut('model-a', 'file') }, // duplicate
    n4: { ...emptyNodeState(), status: 'running' }, // no result yet
  }

  const frame = buildRunFrame({
    chain: chainDef,
    seed: { kind: 'paste' },
    states: statesMap,
    now: 0,
  })

  assert.deepStrictEqual(frame.models, [
    { model: 'model-a', source: 'file' },
    { model: 'model-b', source: 'defaults' },
  ])

  // When states have no results, frame.models is undefined
  const emptyFrame = buildRunFrame({
    chain: chainDef,
    seed: { kind: 'paste' },
    states: {},
    now: 0,
  })
  assert.strictEqual(emptyFrame.models, undefined)
})
