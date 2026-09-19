import { describe, test, afterAll } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { diskRunFolders, memoryRunFolders, type RunFolders } from '../lib/runFolders'
import type { AgentOutput, RunMeta } from '../lib/types'

const temps: string[] = []
afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }) })

function onDisk(): RunFolders {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-folders-'))
  temps.push(root)
  return diskRunFolders(root)
}

const meta = (runId: string, status: RunMeta['status'] = 'waiting'): RunMeta => ({
  runId, chainName: 'c', seedPrompt: 's', startedAt: 't0', status, agentOutputs: [],
})

const output = (nodeId: string, text: string): AgentOutput => ({
  nodeId, agentName: nodeId, systemPrompt: '', input: 'in', output: text,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})

// One contract, both adapters: the in-memory fake behaves as the disk does.
describe.each([['disk', onDisk], ['memory', memoryRunFolders]] as const)('%s run folders', (_, make) => {
  test('a created run reads back; an unknown one throws', () => {
    const runs = make()
    runs.create(meta('r1'))
    assert.deepStrictEqual(runs.read('r1'), meta('r1'))
    assert.throws(() => runs.read('nope'))
  })

  test('update merges a patch; what is read back is a copy', () => {
    const runs = make()
    runs.create(meta('r1'))
    runs.update('r1', { status: 'complete', completedAt: 't1' })
    const read = runs.read('r1')
    assert.strictEqual(read.status, 'complete')
    assert.strictEqual(read.completedAt, 't1')
    read.status = 'error'
    assert.strictEqual(runs.read('r1').status, 'complete')
  })

  test('update drops undefined fields as JSON does', () => {
    const runs = make()
    runs.create(meta('r1'))
    runs.update('r1', { completedAt: undefined })
    assert.strictEqual('completedAt' in runs.read('r1'), false)
  })

  test('claim marks a run running once; a second claim is refused and changes nothing', () => {
    const runs = make()
    runs.create(meta('r1'))
    assert.strictEqual(runs.claim('r1', { holds: [] }), true)
    assert.strictEqual(runs.read('r1').status, 'running')
    assert.strictEqual(runs.claim('r1', { seedPrompt: 'second' }), false)
    assert.strictEqual(runs.read('r1').seedPrompt, 's')
  })

  test('steps number after the highest logged; a node\'s latest step is its highest', () => {
    const runs = make()
    runs.create(meta('r1'))
    assert.strictEqual(runs.nextStep('r1'), 0)
    runs.writeStep('r1', 0, output('a', 'one'))
    runs.writeStep('r1', 3, output('b', 'two'))
    runs.writeStep('r1', 5, output('a', 'three'))
    runs.writeStep('r1', 5, output('a', 'rewritten'))
    assert.strictEqual(runs.nextStep('r1'), 6)
    assert.strictEqual(runs.latestStepOf('r1', 'a'), 5)
    assert.strictEqual(runs.latestStepOf('r1', 'b'), 3)
    assert.strictEqual(runs.latestStepOf('r1', 'c'), undefined)
  })

  test('list returns every run', () => {
    const runs = make()
    assert.deepStrictEqual(runs.list(), [])
    runs.create(meta('r1'))
    runs.create(meta('r2', 'complete'))
    assert.deepStrictEqual(runs.list().map(r => r.runId).sort(), ['r1', 'r2'])
  })
})

test('the disk adapter writes meta.json and step logs where a run folder has them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-folders-'))
  temps.push(root)
  const runs = diskRunFolders(root)
  runs.create(meta('r1'))
  runs.writeStep('r1', 2, output('dec', 'text'))
  const dir = path.join(root, 'logs', 'r1')
  assert.strictEqual(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'), JSON.stringify(meta('r1'), null, 2))
  assert.ok(fs.readFileSync(path.join(dir, '02-dec.md'), 'utf-8').endsWith('text\n'))
})
