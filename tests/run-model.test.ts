import { test } from 'vitest'
// tests/run-model.test.ts
import assert from 'node:assert'
import { applyInstanceEvent, nodeStateFor, InstanceRunMap, applyInstanceOrder, InstanceOrder, orderFor } from '../lib/runModel'
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

test('run-model execution order', () => {
  let o: InstanceOrder = {}

  // first agent_start per node appends; a re-entered loop node does not duplicate
  o = applyInstanceOrder(o, 0, { type: 'agent_start', nodeId: 'n1', agentName: 'draft', step: 0 })
  o = applyInstanceOrder(o, 0, { type: 'agent_start', nodeId: 'n2', agentName: 'patch', step: 1 })
  o = applyInstanceOrder(o, 0, { type: 'agent_start', nodeId: 'n2', agentName: 'patch', step: 2 })
  o = applyInstanceOrder(o, 0, { type: 'agent_start', nodeId: 'n3', agentName: 'report', step: 3 })
  assert.deepStrictEqual(orderFor(o, 0), ['n1', 'n2', 'n3'])

  // instances order independently
  o = applyInstanceOrder(o, 1, { type: 'agent_start', nodeId: 'n3', agentName: 'report', step: 0 })
  assert.deepStrictEqual(orderFor(o, 1), ['n3'])
  assert.deepStrictEqual(orderFor(o, 0), ['n1', 'n2', 'n3'])

  // a node that only ever reports agent_done (skipped/control nodes) still gets a slot
  o = applyInstanceOrder(o, 0, { type: 'agent_done', nodeId: 'n4', agentName: 'gate', step: 4, output: {} as AgentOutput })
  assert.deepStrictEqual(orderFor(o, 0), ['n1', 'n2', 'n3', 'n4'])

  // except loop-end, whose record is empty bookkeeping — the zone finished (#33).
  // Filtered on the graph's own `kind`, not the executor's label string (#35):
  // a reworded label must not bring the row back.
  o = applyInstanceOrder(o, 0, { type: 'agent_done', nodeId: 'le', agentName: 'zone wrapped up', step: 5, kind: 'loop-end', output: {} as AgentOutput })
  assert.deepStrictEqual(orderFor(o, 0), ['n1', 'n2', 'n3', 'n4'])

  // and a node merely *named* loop-end is not filtered — the string match is gone
  o = applyInstanceOrder(o, 0, { type: 'agent_done', nodeId: 'n5', agentName: 'loop-end', step: 6, kind: 'agent', output: {} as AgentOutput })
  assert.deepStrictEqual(orderFor(o, 0), ['n1', 'n2', 'n3', 'n4', 'n5'])

  // non-node events and unknown instances are inert
  o = applyInstanceOrder(o, 0, { type: 'run_complete', runId: 'r1' })
  assert.deepStrictEqual(orderFor(o, 0), ['n1', 'n2', 'n3', 'n4', 'n5'])
  assert.deepStrictEqual(orderFor(o, 7), [])
})
