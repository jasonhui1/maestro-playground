import { describe, test } from 'vitest'
import assert from 'node:assert'
import { upstreamSubgraph, downstreamIds, runLog } from '../lib/partialRun'
import type { AgentOutput, ChainDef, HoldRecord } from '../lib/types'

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

describe('runLog', () => {
  const edge = (f: string, t: string) => ({ fromNode: f, fromSocket: 'output', toNode: t, toSocket: 'input' })
  const graph = {
    nodes: ['a', 'b', 'c', 'side'].map(id => ({ id, kind: 'agent' as const, agent: 'z' })),
    edges: [edge('a', 'b'), edge('b', 'c')],
  }
  const out = (nodeId: string | undefined, output: string, round?: number): AgentOutput => ({
    nodeId, round, agentName: nodeId ?? '', systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  })
  const hold = (nodeId: string, resolved = true): HoldRecord => ({
    nodeId, input: '', candidates: [], reachedAt: '', ...(resolved ? { resolvedAt: 'x' } : {}),
  })

  test('current: the latest write per node and round wins, at its own position', () => {
    const log = runLog({
      graph,
      agentOutputs: [out('a', 'a1'), out('b', 'b1'), out('a', 'a2'), out('side', 's0', 0), out('side', 's1', 1)],
    })
    assert.deepStrictEqual(log.current().map(o => o.output), ['b1', 'a2', 's0', 's1'])
  })

  test('current: records with no node are never collapsed', () => {
    const log = runLog({ agentOutputs: [out(undefined, 'x1'), out(undefined, 'x2')] })
    assert.deepStrictEqual(log.current().map(o => o.output), ['x1', 'x2'])
  })

  test('below: an anchor\'s descendants, not the anchor', () => {
    assert.deepStrictEqual([...runLog({ graph, agentOutputs: [] }).below('a')].sort(), ['b', 'c'])
  })

  test('replayFor: current records outside the anchors and their descendants, and answered holds above', () => {
    const log = runLog({
      graph,
      agentOutputs: [out('a', 'a1'), out('side', 's'), out('a', 'a2'), out('b', 'b1'), out('c', 'c1')],
      holds: [hold('a'), hold('b'), hold('side', false)],
    })
    const { replay, holds } = log.replayFor(['b'])
    assert.deepStrictEqual(replay.map(o => o.output), ['s', 'a2'])
    assert.deepStrictEqual(holds.map(h => h.nodeId), ['a'], 'open holds carry no answer to replay')
  })

  test('replayFor: several anchors drop the union', () => {
    const log = runLog({ graph, agentOutputs: [out('a', 'a1'), out('b', 'b1'), out('c', 'c1'), out('side', 's')] })
    assert.deepStrictEqual(log.replayFor(['c', 'side']).replay.map(o => o.output), ['a1', 'b1'])
  })
})
