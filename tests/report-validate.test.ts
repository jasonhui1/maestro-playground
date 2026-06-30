import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import type { ChainDef } from '../lib/types'

// Case 1: Valid seed -> report.in
const validChain: ChainDef = {
  slug: 'c1', name: 'c1', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'rep', kind: 'report' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'rep', toSocket: 'in' },
  ],
}
const res1 = validateChain(validChain, [], [])
assert.strictEqual(res1.valid, true, 'valid chain should pass validation')
assert.strictEqual(res1.errors.length, 0, 'no errors on valid chain')

// Case 2: Edge out of report (report.output -> agent.in) should fail
const invalidOutChain: ChainDef = {
  slug: 'c2', name: 'c2', description: '', filePath: '',
  nodes: [
    { id: 'rep', kind: 'report' },
    { id: 'agent', kind: 'agent', agent: 'my-agent' },
  ],
  edges: [
    { fromNode: 'rep', fromSocket: 'output', toNode: 'agent', toSocket: 'prompt' },
  ],
}
const res2 = validateChain(invalidOutChain, [{ slug: 'my-agent', name: 'Agent', model: 'm', description: '', skills: [], context: [], input_from: 'user', output_format: 'markdown', outputs: [], inputs: [{ name: 'prompt' }], systemPrompt: 'hello {prompt}', filePath: '' }], [])
assert.strictEqual(res2.valid, false, 'chain with edge out of report should fail validation')
assert.ok(res2.errors.some(e => e.includes('no such output socket')), 'should report missing output socket error')

// Case 3: Unwired report produces a warning
const unwiredChain: ChainDef = {
  slug: 'c3', name: 'c3', description: '', filePath: '',
  nodes: [
    { id: 'rep', kind: 'report' },
  ],
  edges: [],
}
const res3 = validateChain(unwiredChain, [], [])
assert.strictEqual(res3.valid, true, 'unwired report is still valid (warning only)')
assert.ok(res3.issues.some(i => i.severity === 'warning' && i.message.includes('report has no incoming')), 'should report warning for unwired report')

console.log('✅ report validation tests passed')
