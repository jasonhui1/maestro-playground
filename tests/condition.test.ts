import assert from 'node:assert'
import { evalCondition } from '../lib/condition'
import { AgentOutput } from '../lib/types'

function out(nodeId: string, output: string): AgentOutput {
  return { nodeId, agentName: nodeId, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}
const ctx = new Map<string, AgentOutput>([
  ['v', out('v', 'Result: VALID')],
  ['t', out('t', '## Verdict\nAPPROVED')],
  ['e', out('e', '')],
])

assert.strictEqual(evalCondition('{v.output} contains "valid"', ctx), true)   // case-insensitive
assert.strictEqual(evalCondition('{v.output} == "result: valid"', ctx), true) // trimmed + ci
assert.strictEqual(evalCondition('{v.output} != "nope"', ctx), true)
assert.strictEqual(evalCondition('{t.verdict} == "approved"', ctx), true)     // section slice
assert.strictEqual(evalCondition('exists {v.output}', ctx), true)
assert.strictEqual(evalCondition('exists {e.output}', ctx), false)            // empty
assert.strictEqual(evalCondition('exists {missing.output}', ctx), false)      // unknown node
assert.strictEqual(evalCondition('{v.output} contains "OK" || {t.verdict} == "approved"', ctx), true)
assert.strictEqual(evalCondition('{v.output} contains "OK" && {t.verdict} == "approved"', ctx), false)
assert.strictEqual(evalCondition('!({v.output} contains "OK")', ctx), true)
assert.strictEqual(evalCondition('garbage (', ctx), false)                    // parse failure -> false
console.log('✅ condition tests passed')
