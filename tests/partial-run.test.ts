import { test } from 'vitest'
import assert from 'node:assert'
import { upstreamSubgraph, downstreamIds } from '../lib/partialRun'
import { ChainDef } from '../lib/types'

test('partial-run', () => {
  const edge = (f: string, t: string) => ({ fromNode: f, fromSocket: 'output', toNode: t, toSocket: 'input' })

  // linear a->b->c->d ; target c keeps {a,b,c}, drops d
  const linear: ChainDef = {
    slug: 'x', name: 'x', description: '', filePath: '',
    nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, kind: 'agent' as const, agent: 'z' })),
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
  }
  const up = upstreamSubgraph(linear, 'c')
  assert.deepStrictEqual(up.nodes.map(n => n.id).sort(), ['a', 'b', 'c'])
  assert.strictEqual(up.edges.length, 2)

  // unrelated branch is excluded: a->b, x->b ; target a keeps only {a}
  const branchy: ChainDef = {
    slug: 'y', name: 'y', description: '', filePath: '',
    nodes: ['a', 'b', 'x'].map(id => ({ id, kind: 'agent' as const, agent: 'z' })),
    edges: [edge('a', 'b'), edge('x', 'b')],
  }
  assert.deepStrictEqual(upstreamSubgraph(branchy, 'a').nodes.map(n => n.id), ['a'])

  // zone expansion: a body member pulls in the whole zone
  const looped: ChainDef = {
    slug: 'z', name: 'z', description: '', filePath: '',
    nodes: [
      { id: 'ls', kind: 'loop-start', zone: 'z1', state: [] },
      { id: 'body', kind: 'agent', agent: 'z', zone: 'z1' },
      { id: 'le', kind: 'loop-end', zone: 'z1', until: '', maxIterations: 2 },
    ],
    edges: [edge('ls', 'body'), edge('body', 'le')],
  }
  assert.deepStrictEqual(upstreamSubgraph(looped, 'body').nodes.map(n => n.id).sort(), ['body', 'le', 'ls'])
})

test('downstreamIds excludes the source and pulls in a touched loop zone whole', () => {
  const edge = (f: string, t: string) => ({ fromNode: f, fromSocket: 'output', toNode: t, toSocket: 'input' })
  const graph = {
    nodes: [
      { id: 'a', kind: 'agent' as const, agent: 'z' },
      { id: 'side', kind: 'agent' as const, agent: 'z' },
      { id: 'ls', kind: 'loop-start' as const, zone: 'z1' },
      { id: 'body', kind: 'agent' as const, agent: 'z', zone: 'z1' },
      { id: 'le', kind: 'loop-end' as const, zone: 'z1' },
      { id: 'after', kind: 'agent' as const, agent: 'z' },
    ],
    edges: [edge('side', 'ls'), edge('ls', 'body'), edge('body', 'le'), edge('a', 'body'), edge('le', 'after')],
  }
  assert.deepStrictEqual([...downstreamIds(graph, 'a')].sort(), ['after', 'body', 'le', 'ls'])
  assert.deepStrictEqual([...downstreamIds(graph, 'after')], [])
})
