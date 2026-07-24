import { test } from 'vitest'
import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'
import type { ChainNode } from '../lib/types'

test('parse-loop', () => {
  const raw = `---
name: demo
nodes:
  - { id: ls, kind: loop-start, zone: refine, state: [draft, feedback] }
  - { id: p, kind: agent, agent: patch-agent, zone: refine }
  - { id: le, kind: loop-end, zone: refine, until: '{p.output} contains "DONE"', maxIterations: 4 }
edges:
  - { from: ls.draft, to: p.previous }
---
`
  const c = parseChainContent(raw, 'demo')
  const ls = c.nodes.find(n => n.id === 'ls')! as Extract<ChainNode, { kind: 'loop-start' }>
  assert.strictEqual(ls.kind, 'loop-start')
  assert.strictEqual(ls.zone, 'refine')
  assert.deepStrictEqual(ls.state, ['draft', 'feedback'])
  const le = c.nodes.find(n => n.id === 'le')! as Extract<ChainNode, { kind: 'loop-end' }>
  assert.strictEqual(le.until, '{p.output} contains "DONE"')
  assert.strictEqual(le.maxIterations, 4)
  assert.strictEqual(c.nodes.find(n => n.id === 'p')!.zone, 'refine')
})
