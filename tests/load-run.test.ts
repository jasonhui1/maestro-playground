import { test } from 'vitest'
import assert from 'node:assert'
import { loadRunFor } from '../lib/loadRun'
import { toResponse } from '../lib/refusal'
import { readPick } from '../lib/hold'
import { memoryRunFolders } from '../lib/runFolders'
import type { HoldRecord, RunMeta } from '../lib/types'

const runs = memoryRunFolders()

const run = (runId: string, status: RunMeta['status']): RunMeta => {
  const meta: RunMeta = { runId, chainName: 'c', seedPrompt: '', startedAt: '', status, agentOutputs: [] }
  runs.create(meta)
  return meta
}

test('an unknown run is a 404 refusal', () => {
  assert.deepStrictEqual(loadRunFor(runs, 'no-such-run'), { error: 'Run not found', status: 404 })
})

test('a running run loads, unless it must not be running: then a 409 refusal', () => {
  const meta = run('r1', 'running')
  assert.deepStrictEqual(loadRunFor(runs, 'r1'), meta)
  assert.deepStrictEqual(loadRunFor(runs, 'r1', { mustNotBeRunning: true }), { error: 'Run is running', status: 409 })
})

test('a run that is not running loads either way', () => {
  const meta = run('r2', 'waiting')
  assert.deepStrictEqual(loadRunFor(runs, 'r2', { mustNotBeRunning: true }), meta)
})

test('a refusal encodes as a JSON response with its status', async () => {
  const hold: HoldRecord = { nodeId: 'gate', input: '', reachedAt: '', candidates: [{ heading: 'Candidate 1', body: 'A' }] }
  const pick = readPick(hold, 'Candidate 9', undefined)
  assert.ok(pick && 'error' in pick)
  const res = toResponse(pick)
  assert.strictEqual(res.status, 400)
  assert.deepStrictEqual(await res.json(), { error: pick.error })
})

test('a refusal carries its errors list when it has one', async () => {
  const res = toResponse({ error: 'Chain is invalid', status: 422, errors: ['a'] })
  assert.strictEqual(res.status, 422)
  assert.deepStrictEqual(await res.json(), { error: 'Chain is invalid', errors: ['a'] })
})
