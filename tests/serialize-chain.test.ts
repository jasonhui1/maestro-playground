import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'
import type { ChainDef } from '../lib/types'

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
  const out = serializeChain(c, c.nodes, c.edges)
  const c2 = parseChainContent(out, 'triage-demo')
  assert.deepStrictEqual(c2, c)

  // Edge socket collapsing: output omitted, named sockets kept
  assert.ok(/from: seed\n/.test(out) || /from: seed$/m.test(out), 'output socket should collapse to bare node')
  assert.ok(/t\.input/.test(out), 'named input socket retained')

  // No value anywhere in the tree may be undefined — js-yaml aborts the whole dump on one.
  const noName = parseChainContent('---\nnodes:\n  - { id: a, kind: report }\n---\n', 'no-name')
  assert.strictEqual(noName.name, 'no-name', 'a file without name: is named by its slug')
  serializeChain(
    { slug: 'no-name', name: undefined as unknown as string, description: undefined as unknown as string, filePath: '', nodes: [], edges: [],
      inputs: [{ name: 'in', node: 'seed', socket: undefined }] },
    [{ id: 'a', kind: 'report', pos: undefined, zone: undefined } as never],
    [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'in' }],
  )

  // Empty chain
  const empty = serializeChain({ slug: 'x', name: 'x', description: '', filePath: '', nodes: [], edges: [] }, [], [])
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
    serializeChain(chain),
    'telephone-relay',
  )
  assert.strictEqual(again.view, 'timeline')
  assert.strictEqual(again.moment, 'finalizing a doc, not sure it holds up')
})

test('round-trip preserves every declared chain key (#109)', () => {
  const raw = `---
name: full-chain
description: A chain carrying every declared key
view: columns
moment: testing round-trip with all declared keys
purpose: insight
parameter:
  name: target
  options:
    - optA
    - optB
  node: paramNode
nodes:
  - id: seedNode
    kind: seed
    pos: [0, 0]
  - id: paramNode
    kind: param
    pos: [0, 100]
  - id: agentNode
    kind: agent
    agent: test-agent
    pos: [200, 0]
edges:
  - from: seedNode
    to: agentNode.input
inputs:
  - name: inPort
    node: seedNode
outputs:
  - name: outPanel
    node: agentNode
    socket: summary
    role: join
---
`
  const parsed = parseChainContent(raw, 'full-chain')
  const serialized = serializeChain(parsed)
  const reparsed = parseChainContent(serialized, 'full-chain')
  assert.deepStrictEqual(reparsed, parsed)
})

test('saving domain-transplant and wrong-audience preserves parameter (#109)', () => {
  const chainsDir = path.join(process.cwd(), 'workspace', 'chains')
  for (const slug of ['domain-transplant', 'wrong-audience']) {
    const raw = fs.readFileSync(path.join(chainsDir, `${slug}.md`), 'utf-8')
    const initialChain = parseChainContent(raw, slug)
    assert.ok(initialChain.parameter, `${slug} must declare parameter`)

    // Editor saves by passing the chain directly with current interface, nodes, edges (#109)
    const editorChain: ChainDef = {
      ...initialChain,
      inputs: initialChain.inputs ?? [],
      outputs: initialChain.outputs ?? [],
      nodes: initialChain.nodes,
      edges: initialChain.edges,
    }
    const saved = serializeChain(editorChain)
    const reparsed = parseChainContent(saved, slug)

    assert.deepStrictEqual(reparsed.parameter, initialChain.parameter)
    assert.strictEqual(reparsed.purpose, initialChain.purpose)
    assert.strictEqual(reparsed.view, initialChain.view)
    assert.strictEqual(reparsed.moment, initialChain.moment)
  }
})
