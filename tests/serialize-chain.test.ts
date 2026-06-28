import assert from 'node:assert'
import { serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/fs/parseChain'

// Round-trip invariant: parse(serialize(parse(raw))) deep-equals parse(raw)
const raw = `---
name: triage-demo
description: demo
nodes:
  - { id: seed, kind: seed }
  - { id: t, kind: agent, agent: triage, pos: [250, 0] }
  - { id: b, kind: branch, cases: [{ label: urgent, condition: '{t.output} contains "URGENT"' }], default: other, pos: [500, 0] }
  - { id: ls, kind: loop-start, zone: z1, state: [draft], pos: [750, 0] }
  - { id: le, kind: loop-end, zone: z1, until: '{ls.draft} contains "DONE"', maxIterations: 3, pos: [1000, 0] }
edges:
  - { from: seed.output, to: t.input }
  - { from: t.output, to: b.in }
  - { from: b.urgent, to: ls.draft }
---
`
const c = parseChainContent(raw, 'triage-demo')
const out = serializeChain({ name: c.name, description: c.description }, c.nodes, c.edges)
const c2 = parseChainContent(out, 'triage-demo')
assert.deepStrictEqual(c2, c)

// Edge socket collapsing: output omitted, named sockets kept
assert.ok(/from: seed\n/.test(out) || /from: seed$/m.test(out), 'output socket should collapse to bare node')
assert.ok(/t\.input/.test(out), 'named input socket retained')

// Empty chain
const empty = serializeChain({ name: 'x', description: '' }, [], [])
const e2 = parseChainContent(empty, 'x')
assert.deepStrictEqual(e2.nodes, [])
assert.deepStrictEqual(e2.edges, [])

console.log('✅ serialize-chain tests passed')
