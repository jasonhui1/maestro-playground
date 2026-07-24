import { test } from 'vitest'
import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'
import type { ChainNode } from '../lib/types'

test('parse-control', () => {
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
  const gate = c.nodes[0] as Extract<ChainNode, { kind: 'gate' }>
  const branch = c.nodes[1] as Extract<ChainNode, { kind: 'branch' }>
  const decider = c.nodes[2] as Extract<ChainNode, { kind: 'decider' }>
  assert.strictEqual(gate.kind, 'gate')
  assert.strictEqual(gate.condition, '{v.output} contains "OK"')
  assert.deepStrictEqual(branch.cases, [{ label: 'a', condition: '{t.output} contains "A"' }])
  assert.strictEqual(branch.default, 'other')
  assert.strictEqual(decider.kind, 'decider')
  assert.strictEqual(decider.agent, 'judge')
})
