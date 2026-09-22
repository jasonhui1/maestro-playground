import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain, edgeShapeError, issuesByNode } from '../lib/chainGraph'
import { edgeFromConnection } from '../lib/editorOps'
import type { ChainDef, ChainEdge } from '../lib/types'

function chain(edges: ChainEdge[]): ChainDef {
  return {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [{ id: 'seed', kind: 'seed' }, { id: 'j', kind: 'join' }, { id: 'r', kind: 'report' }],
    edges,
  }
}

test('validateChain rejects a self-edge and an unnamed socket, attributed to the edge', () => {
  const self: ChainEdge = { fromNode: 'j', fromSocket: 'output', toNode: 'j', toSocket: 'in' }
  const unnamed: ChainEdge = { fromNode: 'seed', fromSocket: '', toNode: 'r', toSocket: 'in' }
  const v = validateChain(chain([self, unnamed]), {})
  assert.strictEqual(v.valid, false)
  assert.ok(v.issues.some(i => i.edge === self && i.message === edgeShapeError(self)))
  assert.ok(v.issues.some(i => i.edge === unnamed && i.message === edgeShapeError(unnamed)))
})

test('the canvas refuses exactly the connections validation rejects', () => {
  const connections = [
    { source: 'seed', sourceHandle: 'output', target: 'r', targetHandle: 'in' },
    { source: 'j', sourceHandle: 'output', target: 'j', targetHandle: 'in' },
    { source: 'seed', sourceHandle: null, target: 'r', targetHandle: 'in' },
    { source: 'seed', sourceHandle: 'output', target: 'r', targetHandle: null },
    { source: 'seed', sourceHandle: 'output', target: 'r' },
  ]
  for (const c of connections) {
    const edge: ChainEdge = { fromNode: c.source, fromSocket: c.sourceHandle ?? '', toNode: c.target, toSocket: c.targetHandle ?? '' }
    const rejected = validateChain(chain([edge]), {}).issues.some(i => i.edge === edge && i.message === edgeShapeError(edge))
    assert.strictEqual(edgeFromConnection(c) === null, rejected, JSON.stringify(c))
    if (!rejected) assert.deepStrictEqual(edgeFromConnection(c), edge)
  }
})

test('panel and node borders fold the same issues', () => {
  const self: ChainEdge = { fromNode: 'j', fromSocket: 'output', toNode: 'j', toSocket: 'in' }
  const bad = { ...chain([self]), nodes: [...chain([]).nodes, { id: 'h', kind: 'hold' as const }] }
  const { issues } = validateChain(bad, {})
  const byNode = issuesByNode(issues)
  // every attributable panel issue borders its node, and borders carry nothing else
  const attributable = issues.filter(i => i.nodeId ?? i.edge?.toNode)
  assert.ok(attributable.length >= 2)
  for (const i of attributable) assert.ok(byNode.get((i.nodeId ?? i.edge!.toNode))!.includes(i.message))
  assert.strictEqual([...byNode.values()].flat().length, attributable.length)
})
