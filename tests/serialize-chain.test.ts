import { test } from 'vitest'
import assert from 'node:assert'
import { serializeChain, chainMeta } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'

test('serialize-chain', () => {
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
  - { id: rep, kind: report, pos: [1250, 0] }
edges:
  - { from: seed.output, to: t.input }
  - { from: t.output, to: b.in }
  - { from: b.urgent, to: ls.draft }
  - { from: le.output, to: rep.in }
---
`
  const c = parseChainContent(raw, 'triage-demo')
  const out = serializeChain({ name: c.name, description: c.description }, c.nodes, c.edges)
  const c2 = parseChainContent(out, 'triage-demo')
  assert.deepStrictEqual(c2, c)

  // Edge socket collapsing: output omitted, named sockets kept
  assert.ok(/from: seed\n/.test(out) || /from: seed$/m.test(out), 'output socket should collapse to bare node')
  assert.ok(/t\.input/.test(out), 'named input socket retained')

  // No value anywhere in the tree may be undefined — js-yaml aborts the whole dump on one.
  const noName = parseChainContent('---\nnodes:\n  - { id: a, kind: report }\n---\n', 'no-name')
  assert.strictEqual(noName.name, 'no-name', 'a file without name: is named by its slug')
  serializeChain(
    { name: undefined as unknown as string, description: undefined,
      inputs: [{ name: 'in', node: 'seed', socket: undefined }] },
    [{ id: 'a', kind: 'report', pos: undefined, zone: undefined } as never],
    [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'in' }],
  )

  // Empty chain
  const empty = serializeChain({ name: 'x', description: '' }, [], [])
  const e2 = parseChainContent(empty, 'x')
  assert.deepStrictEqual(e2.nodes, [])
  assert.deepStrictEqual(e2.edges, [])
})

// The editor reserializes the whole frontmatter on every graph change, so a display-only
// field the result frame reads has to survive a drag (ADR-0016, #73).
test('serialize-chain keeps view and moment through a round trip', () => {
  const raw = `---
name: telephone-relay
description: three restatements
view: timeline
moment: finalizing a doc, not sure it holds up
nodes:
  - { id: seed, kind: seed }
---
`
  const chain = parseChainContent(raw, 'telephone-relay')
  assert.strictEqual(chain.moment, 'finalizing a doc, not sure it holds up')

  const again = parseChainContent(
    serializeChain(chainMeta(chain), chain.nodes, chain.edges),
    'telephone-relay',
  )
  assert.strictEqual(again.view, 'timeline')
  assert.strictEqual(again.moment, 'finalizing a doc, not sure it holds up')
})
