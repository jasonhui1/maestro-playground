import { test } from 'vitest'
// tests/run-model.test.ts
import assert from 'node:assert'
import { applyInstanceEvent, nodeStateFor, InstanceRunMap } from '../lib/runModel'
import { AgentOutput } from '../lib/types'

test('run-model', () => {
  function out(o: Partial<{ output: string; status: string; round: number; agentName: string }>) {
    return { agentName: 'w', systemPrompt: '', input: '', output: '', thought: '', tokensIn: 0,
      tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...o } as unknown as AgentOutput
  }

  let m: InstanceRunMap = {}

  // two instances accumulate independently under the same nodeId
  m = applyInstanceEvent(m, 0, { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 })
  m = applyInstanceEvent(m, 1, { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 })
  m = applyInstanceEvent(m, 0, { type: 'token', nodeId: 'a', token: 'zero', step: 0 })
  m = applyInstanceEvent(m, 1, { type: 'token', nodeId: 'a', token: 'one', step: 0 })
  assert.strictEqual(m[0].a.output, 'zero')
  assert.strictEqual(m[1].a.output, 'one')
  assert.strictEqual(nodeStateFor(m, 0, 'a')?.output, 'zero')
  assert.strictEqual(nodeStateFor(m, 1, 'a')?.output, 'one')

  // agent_done routes to the correct instance only
  m = applyInstanceEvent(m, 1, { type: 'agent_done', nodeId: 'a', agentName: 'w', step: 0, output: out({ output: 'one', status: 'success' }) })
  assert.strictEqual(m[1].a.status, 'success')
  assert.strictEqual(m[0].a.status, 'running')

  // missing instance / node returns undefined, never throws
  assert.strictEqual(nodeStateFor(m, 9, 'a'), undefined)
  assert.strictEqual(nodeStateFor(m, 0, 'missing'), undefined)
})
