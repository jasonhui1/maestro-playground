import assert from 'node:assert'
import { applyRunEvent, RunStateMap } from '../lib/runState'
import { AgentOutput } from '../lib/types'

function out(overrides: Partial<{ output: string; status: string; round: number; agentName: string }>) {
  return { agentName: 'w', systemPrompt: '', input: '', output: '', thought: '', tokensIn: 0, tokensOut: 0,
    costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...overrides } as unknown as AgentOutput
}

let s: RunStateMap = {}
s = applyRunEvent(s, { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 })
assert.strictEqual(s.a.status, 'running')

s = applyRunEvent(s, { type: 'token', nodeId: 'a', token: 'he', step: 0 })
s = applyRunEvent(s, { type: 'token', nodeId: 'a', token: 'llo', step: 0 })
assert.strictEqual(s.a.output, 'hello')

s = applyRunEvent(s, { type: 'agent_done', nodeId: 'a', agentName: 'w', step: 0, output: out({ output: 'hello', status: 'success' }) })
assert.strictEqual(s.a.status, 'success')
assert.strictEqual(s.a.output, 'hello')

// thought tokens accumulate separately
s = applyRunEvent(s, { type: 'token', nodeId: 'a', token: 'hmm', tokenType: 'thought', step: 0 })
assert.strictEqual(s.a.thought, 'hmm')

// looped node: agent_done with round archives into rounds, resets buffer on next start
let l: RunStateMap = {}
l = applyRunEvent(l, { type: 'agent_start', nodeId: 'p', agentName: 'patch', step: 1 })
l = applyRunEvent(l, { type: 'agent_done', nodeId: 'p', agentName: 'patch', step: 1, output: out({ output: 'v1', round: 0 }) })
l = applyRunEvent(l, { type: 'agent_start', nodeId: 'p', agentName: 'patch', step: 2 })
l = applyRunEvent(l, { type: 'agent_done', nodeId: 'p', agentName: 'patch', step: 2, output: out({ output: 'v2', round: 1 }) })
assert.deepStrictEqual(l.p.rounds, [{ round: 0, output: 'v1' }, { round: 1, output: 'v2' }])
assert.strictEqual(l.p.output, 'v2')

// skipped status carried through
let k: RunStateMap = {}
k = applyRunEvent(k, { type: 'agent_done', nodeId: 'z', agentName: 'z', step: 5, output: out({ output: '', status: 'skipped' }) })
assert.strictEqual(k.z.status, 'skipped')

console.log('✅ run-state tests passed')
