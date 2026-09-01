import { test } from 'vitest'
import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'

test('parse-chain', () => {
  const raw = `---
name: story-chain
description: demo
nodes:
  - { id: seed, kind: seed }
  - { id: wb, kind: agent, agent: world-builder, pos: [250, 0] }
edges:
  - { from: seed.output, to: wb.input }
---
`
  const c = parseChainContent(raw, 'story-chain')
  assert.strictEqual(c.name, 'story-chain')
  assert.strictEqual(c.nodes.length, 2)
  assert.deepStrictEqual(c.nodes[1], {
    id: 'wb',
    kind: 'agent',
    agent: 'world-builder',
    file: undefined,
    pos: [250, 0],
    condition: undefined,
    cases: undefined,
    default: undefined,
    zone: undefined,
    state: undefined,
    until: undefined,
    maxIterations: undefined,
    subchain: undefined,
    'skills!': undefined,
    'skills+': undefined,
  })
  assert.deepStrictEqual(c.edges[0], { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' })

  // missing nodes/edges => empty arrays
  const empty = parseChainContent(`---\nname: x\n---\n`, 'x')
  assert.deepStrictEqual(empty.nodes, [])
  assert.deepStrictEqual(empty.edges, [])
})

// A port's `role: join` is what marks a columns chain's converging panel (#67,
// ADR-0016) — dropped on parse, every columns chain on disk would render joinless.
test('a port carries its declared role through parsing', () => {
  const raw = `---
name: five-personas
view: columns
outputs:
  - { name: optimist, node: optimist }
  - { name: joined, node: synthesizer, role: join }
---
`
  const c = parseChainContent(raw, 'five-personas')
  assert.deepStrictEqual(c.outputs, [
    { name: 'optimist', node: 'optimist' },
    { name: 'joined', node: 'synthesizer', role: 'join' },
  ])
})

// `purpose` groups the picker (#70, ADR-0016); an unrecognized or absent value
// must fall through to undefined rather than a made-up group.
test('a declared purpose is parsed; an unrecognized one is dropped', () => {
  const insight = parseChainContent(`---\nname: x\npurpose: insight\n---\n`, 'x')
  assert.strictEqual(insight.purpose, 'insight')

  const none = parseChainContent(`---\nname: x\n---\n`, 'x')
  assert.strictEqual(none.purpose, undefined)

  const bogus = parseChainContent(`---\nname: x\npurpose: not-a-real-purpose\n---\n`, 'x')
  assert.strictEqual(bogus.purpose, undefined)
})
