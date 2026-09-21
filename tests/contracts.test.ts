import { test, beforeAll, afterAll, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { requestEntry } from './helpers/requestWorkspace'
import { fakeModel } from './helpers/fakeModel'
import {
  initContractWorkspace,
  contractModelResponder,
  runFreshScenario,
  runHoldScenario,
  runResumeScenario,
  runPromoteScenario,
  runForkScenario,
  runErrorScenario,
  runCapabilitiesScenario,
  getContractManifest,
  formatJson,
  type ScenarioContext,
} from './helpers/contractScenarios'

// #136: Mock request workspace, logger ID generation, and model chatCall
vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

let currentRunId = 'contract-run-default'
export function setNextRunId(id: string) {
  currentRunId = id
}
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>()
  return {
    ...actual,
    newRunId: () => currentRunId,
  }
})

const fake = fakeModel(contractModelResponder)
vi.mock('@/lib/chatCall', () => ({ createChatCall: fake.createChatCall }))

beforeAll(() => {
  delete process.env.AI_MODEL_OVERRIDE
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

afterEach(() => {
  fake.reset()
  requestEntry.wrap = undefined
})

const setTime = (iso: string) => vi.setSystemTime(new Date(iso))
const context: ScenarioContext = { setRunId: setNextRunId, setTime }

function freshWorkspace(): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-contract-'))
  requestEntry.root = wp
  initContractWorkspace(wp)
  return wp
}

test('contract: fresh run produces exact stream frames, layout and metadata (#136)', async () => {
  freshWorkspace()
  const result = await runFreshScenario(context)

  assert.strictEqual(result.events[0].type, 'run_start')
  assert.strictEqual(result.events[0].runId, 'contract-run-fresh')
  assert.strictEqual(result.events[1].type, 'layout')
  assert.strictEqual(result.events.at(-1)!.type, 'run_complete')

  const tokenEvents = result.events.filter(e => e.type === 'token')
  assert.ok(tokenEvents.some(e => String(e.token).includes('café')))

  assert.strictEqual(result.metadata?.status, 'complete')
  assert.strictEqual(result.metadata?.runId, 'contract-run-fresh')
})

test('contract: hold run pauses at run_waiting with candidate options (#136)', async () => {
  freshWorkspace()
  const result = await runHoldScenario(context)

  assert.strictEqual(result.events[0].type, 'run_start')
  assert.strictEqual(result.events.at(-1)!.type, 'run_waiting')
  assert.strictEqual(result.events.at(-1)!.nodeId, 'hold')

  const meta = result.metadata as { status: string; holds?: Array<{ candidates: Array<{ heading: string }> }> }
  assert.strictEqual(meta.status, 'waiting')
  assert.strictEqual(meta.holds?.length, 1)
  assert.deepStrictEqual(meta.holds[0].candidates.map(c => c.heading), ['Candidate 1', 'Candidate 2'])
})

test('contract: resume run continues downstream and completes (#136)', async () => {
  freshWorkspace()
  const result = await runResumeScenario(context)

  assert.strictEqual(result.events[0].type, 'run_start')
  assert.strictEqual(result.events[0].runId, 'contract-run-resume')
  assert.strictEqual(result.events.at(-1)!.type, 'run_complete')

  const meta = result.metadata as { status: string; holds?: Array<{ chosen?: string; resolvedAt?: string }> }
  assert.strictEqual(meta.status, 'complete')
  assert.strictEqual(meta.holds?.[0].chosen, 'Candidate 1')
  assert.ok(meta.holds?.[0].resolvedAt)
})

test('contract: promote run updates proposal and re-evaluates decider (#136)', async () => {
  freshWorkspace()
  const result = await runPromoteScenario(context)

  assert.strictEqual(result.events[0].type, 'run_start')
  assert.strictEqual(result.events.at(-1)!.type, 'run_waiting')

  const meta = result.metadata as {
    status: string
    agentOutputs: Array<{ nodeId: string; output: string; conversation?: Array<{ promoted?: boolean }> }>
    holds?: Array<{ candidates: Array<{ body: string }> }>
  }
  assert.strictEqual(meta.status, 'waiting')
  const proposer = meta.agentOutputs.find(o => o.nodeId === 'proposer')!
  assert.ok(proposer.conversation?.some(m => m.promoted))
  assert.ok(meta.holds?.[0].candidates[0].body.includes('Revised Alpha Option'))
})

test('contract: fork run forks from second node, preserving first output and leaving source run unchanged (#136)', async () => {
  freshWorkspace()
  const result = await runForkScenario(context)

  assert.strictEqual(result.events[0].type, 'run_start')
  assert.strictEqual(result.events[0].runId, 'contract-run-fork')
  assert.strictEqual(result.events.at(-1)!.type, 'run_complete')

  const meta = result.metadata as {
    status: string
    branchedFromRunId?: string
    branchedFromNode?: string
    agentOutputs: Array<{ nodeId: string; output: string }>
  }
  assert.strictEqual(meta.status, 'complete')
  assert.strictEqual(meta.branchedFromRunId, 'contract-run-source')
  assert.strictEqual(meta.branchedFromNode, 'second')
  assert.ok(meta.agentOutputs.some(o => o.nodeId === 'first'))

  assert.ok(result.sourceMetadata)
  assert.deepStrictEqual(result.sourceMetadata.after, result.sourceMetadata.before)
})

test('contract: error run produces terminal layout and error frame, plus refusal (#136)', async () => {
  freshWorkspace()
  const result = await runErrorScenario(context)

  assert.strictEqual(result.events[0].type, 'run_start')
  assert.strictEqual(result.events.at(-2)!.type, 'layout')
  assert.strictEqual(result.events.at(-1)!.type, 'error')
  assert.strictEqual(result.events.at(-1)!.error, 'Simulated persistence failure')

  const meta = result.metadata as { status: string }
  assert.strictEqual(meta.status, 'error')

  assert.ok(result.files['refusal-request.json'])
  assert.ok(result.files['refusal-response.json'])
})

test('contract: capabilities object matches workspace flags (#136)', async () => {
  freshWorkspace()
  const caps = await runCapabilitiesScenario()
  assert.strictEqual(caps.runLayoutFrames, true)
  assert.strictEqual(caps.runStartEvent, true)
  assert.strictEqual(caps.runFailureFrame, true)
  assert.strictEqual(caps.runFork, true)
})

function listFilesRecursive(dir: string, base = ''): string[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full, rel))
    } else {
      files.push(rel)
    }
  }
  return files
}

test('contract: fixtures check and update harness (#136)', async () => {
  const contractsDir = path.resolve(process.cwd(), 'contracts')
  const isUpdateMode = process.env.UPDATE_CONTRACTS === '1'

  if (isUpdateMode && process.env.CI) {
    throw new Error('Refusing to update contract fixtures in CI environment')
  }

  freshWorkspace()
  const fresh = await runFreshScenario(context)

  freshWorkspace()
  const hold = await runHoldScenario(context)

  freshWorkspace()
  const resume = await runResumeScenario(context)

  freshWorkspace()
  const promote = await runPromoteScenario(context)

  freshWorkspace()
  const fork = await runForkScenario(context)

  freshWorkspace()
  const error = await runErrorScenario(context)

  freshWorkspace()
  const capabilities = await runCapabilitiesScenario()
  const manifest = getContractManifest()

  const generatedFiles = new Map<string, string>()
  generatedFiles.set('manifest.json', formatJson(manifest))
  generatedFiles.set('capabilities.json', formatJson(capabilities))

  for (const sc of [fresh, hold, resume, promote, fork, error]) {
    for (const [file, content] of Object.entries(sc.files)) {
      generatedFiles.set(`${sc.scenario}/${file}`, content)
    }
  }

  if (isUpdateMode) {
    for (const [relPath, content] of generatedFiles.entries()) {
      const fullPath = path.join(contractsDir, relPath)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, content, 'utf8')
    }
  } else {
    assert.ok(fs.existsSync(contractsDir), 'contracts/ directory does not exist. Run "npm run contracts:update" to generate.')

    for (const [relPath, expectedContent] of generatedFiles.entries()) {
      const fullPath = path.join(contractsDir, relPath)
      assert.ok(fs.existsSync(fullPath), `Missing fixture file: ${relPath}. Run "npm run contracts:update" to regenerate.`)
      const diskContent = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n')
      assert.strictEqual(diskContent, expectedContent, `Drift detected in ${relPath}. Run "npm run contracts:update" if intentional.`)
    }

    const diskFiles = listFilesRecursive(contractsDir).filter(f => f !== 'README.md')
    const expectedFileSet = new Set(generatedFiles.keys())
    for (const f of diskFiles) {
      assert.ok(expectedFileSet.has(f), `Unexpected or obsolete fixture file found in contracts/: ${f}`)
    }
  }
})

test('contract: drift comparison catches reordering, deletion, and frame changes (#136)', () => {
  const original = 'data: {"type":"run_start","runId":"1"}\n\ndata: {"type":"run_complete","runId":"1"}\n\n'
  const modifiedField = 'data: {"type":"run_start","runId":"2"}\n\ndata: {"type":"run_complete","runId":"1"}\n\n'
  const reordered = 'data: {"type":"run_complete","runId":"1"}\n\ndata: {"type":"run_start","runId":"1"}\n\n'
  const deletedFrame = 'data: {"type":"run_start","runId":"1"}\n\n'

  assert.throws(() => assert.strictEqual(modifiedField, original), /runId/)
  assert.throws(() => assert.strictEqual(reordered, original))
  assert.throws(() => assert.strictEqual(deletedFrame, original))
})
