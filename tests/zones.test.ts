import { test } from 'vitest'
import assert from 'node:assert'
import { pairedZones, zoneIssues, zoneNames, zoneMembers, zoneIdOf, renameZone } from '../lib/zones'
import type { ChainEdge, ChainNode } from '../lib/types'

const edge = (fromNode: string, toNode: string, toSocket = 'in'): ChainEdge => ({ fromNode, fromSocket: 'output', toNode, toSocket })

const zoned = (): ChainNode[] => [
  { id: 'ls', kind: 'loop-start', zone: 'z1', state: ['draft', { name: 'notes', accumulate: true, separator: '\n' }], pos: [100, 100] },
  { id: 'b', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 180] },
  { id: 'a', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 100] },
  { id: 'le', kind: 'loop-end', zone: 'z1', until: '{b} done', maxIterations: 4, pos: [500, 100] },
  { id: 'free', kind: 'seed', pos: [0, 0] },
]

test('pairedZones pairs boundaries, parses state and orders the body by its edges', () => {
  const [z, ...rest] = pairedZones({ nodes: zoned(), edges: [edge('b', 'a')] })
  assert.strictEqual(rest.length, 0)
  assert.deepStrictEqual([z.id, z.startId, z.endId], ['z1', 'ls', 'le'])
  assert.deepStrictEqual(z.bodyIds, ['b', 'a'])
  assert.deepStrictEqual(z.bodyOrder, ['b', 'a'])
  assert.deepStrictEqual(pairedZones({ nodes: zoned(), edges: [edge('a', 'b')] })[0].bodyOrder, ['a', 'b'])
  assert.deepStrictEqual(z.states, [
    { name: 'draft', accumulate: false, separator: '\n\n' },
    { name: 'notes', accumulate: true, separator: '\n' },
  ])
  assert.strictEqual(z.until, '{b} done')
  assert.strictEqual(z.maxIterations, 4)
})

test('pairedZones skips a zone missing one boundary and ignores blank zone ids', () => {
  const nodes: ChainNode[] = [
    { id: 'ls', kind: 'loop-start', zone: 'lonely', state: [] },
    { id: 'p', kind: 'agent', agent: 'x', zone: '  ' },
  ]
  assert.deepStrictEqual(pairedZones({ nodes, edges: [] }), [])
  assert.deepStrictEqual(zoneNames(nodes), ['lonely'])
})

test('a whitespace-only zone id is no zone', () => {
  const p: ChainNode = { id: 'p', kind: 'agent', agent: 'x', zone: '  ' }
  assert.strictEqual(zoneIdOf(p), undefined)
  assert.strictEqual(zoneMembers([p]).size, 0)
})

test('zoneMembers groups nodes by zone id in node order', () => {
  const m = zoneMembers(zoned())
  assert.deepStrictEqual([...m.keys()], ['z1'])
  assert.deepStrictEqual(m.get('z1')!.map(n => n.id), ['ls', 'b', 'a', 'le'])
})

test('a body cycle drops its members from the order', () => {
  const z = pairedZones({ nodes: zoned(), edges: [edge('a', 'b'), edge('b', 'a')] })[0]
  assert.deepStrictEqual(z.bodyOrder, [])
})

test('zoneIssues names each way a zone is malformed', () => {
  const messages = (nodes: ChainNode[], edges: ChainEdge[] = []) => zoneIssues({ nodes, edges }).map(i => i.message)
  assert.deepStrictEqual(messages(zoned()), [])
  assert.ok(messages([{ id: 'ls', kind: 'loop-start', state: [] }]).some(m => /has no zone/.test(m)))
  assert.ok(messages([{ id: 'le', kind: 'loop-end', zone: 'z', until: 'x', maxIterations: 2 }]).some(m => /missing a paired loop-start/.test(m)))
  assert.ok(messages([{ id: 'a', kind: 'agent', agent: 'x', zone: 'z' }]).some(m => /needs exactly one loop-start/.test(m)))
  assert.ok(messages([{ id: 'ls', kind: 'loop-start', zone: 'z', state: [] }, { id: 'ls2', kind: 'loop-start', zone: 'z', state: [] }]).some(m => /duplicate loop-start "ls2"/.test(m)))
  const bad = zoned().map(n => n.kind === 'loop-end' ? { ...n, until: ' ', maxIterations: 1.5 } : n)
  assert.strictEqual(messages(bad).filter(m => /needs an "until"|positive integer/.test(m)).length, 2)
  const seedInside = [...zoned(), { id: 's', kind: 'seed', zone: 'z1' } as ChainNode]
  const hit = zoneIssues({ nodes: seedInside, edges: [] }).find(i => i.nodeId === 's')
  assert.ok(hit && hit.zone === 'z1' && /cannot sit inside loop zone/.test(hit.message))
})

test('zoneIssues flags an edge crossing a boundary except into loop-start or out of loop-end', () => {
  const crossing = (e: ChainEdge) => zoneIssues({ nodes: zoned(), edges: [e] }).filter(i => i.edge)
  assert.strictEqual(crossing(edge('free', 'a')).length, 1)
  assert.strictEqual(crossing(edge('a', 'free')).length, 1)
  assert.strictEqual(crossing(edge('free', 'ls', 'draft')).length, 0)
  assert.strictEqual(crossing(edge('le', 'free')).length, 0)
})

test('renameZone renames every member and leaves others alone', () => {
  const renamed = renameZone(zoned(), 'z1', 'z-alpha')
  assert.deepStrictEqual(renamed.filter(n => n.zone === 'z-alpha').map(n => n.id), ['ls', 'b', 'a', 'le'])
  assert.strictEqual(renamed.find(n => n.id === 'free')?.zone, undefined)
  const nodes = zoned()
  assert.strictEqual(renameZone(nodes, 'z1', 'z1'), nodes)
})
