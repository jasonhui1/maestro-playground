import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'

const raw = `---
name: demo
nodes:
  - { id: g, kind: gate, condition: '{v.output} contains "OK"' }
  - { id: r, kind: branch, cases: [ { label: a, condition: '{t.output} contains "A"' } ], default: other }
  - { id: d, kind: decider, agent: judge }
edges:
  - { from: v.output, to: g.in }
---
`
const c = parseChainContent(raw, 'demo')
assert.strictEqual(c.nodes[0].kind, 'gate')
assert.strictEqual(c.nodes[0].condition, '{v.output} contains "OK"')
assert.deepStrictEqual(c.nodes[1].cases, [{ label: 'a', condition: '{t.output} contains "A"' }])
assert.strictEqual(c.nodes[1].default, 'other')
assert.strictEqual(c.nodes[2].kind, 'decider')
assert.strictEqual(c.nodes[2].agent, 'judge')
console.log('✅ parse-control tests passed')
