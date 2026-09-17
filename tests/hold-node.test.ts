import { test } from 'vitest'
import assert from 'node:assert'
import { kindOf } from '../lib/nodeKinds'
import { serializeChain, chainMeta } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'
import { validateChain } from '../lib/chainGraph'
import type { ChainDef, ChainNode } from '../lib/types'

const empty: ChainDef = { slug: 'c', name: 'c', description: '', filePath: '', nodes: [], edges: [] }

function chain(slug: string, nodes: ChainNode[], edges: ChainDef['edges'] = []): ChainDef {
  return { ...empty, slug, name: slug, nodes, edges }
}

const seedToHold = { fromNode: 'seed', fromSocket: 'output', toNode: 'h', toSocket: 'in' }

test('hold descriptor: one input `in`, one output `output`, a prompt field, under Control flow', () => {
  const node: ChainNode = { id: 'h', kind: 'hold' }
  const ws = { chain: empty, agents: [], chains: [] }
  const d = kindOf('hold')
  assert.deepStrictEqual(d.inputs(node, ws), [{ name: 'in' }])
  assert.deepStrictEqual(d.outputs(node, ws), ['output'])
  assert.deepStrictEqual(d.fields, [{ key: 'prompt', codec: 'string' }])
  assert.strictEqual(d.acceptsInputs, true)
  assert.deepStrictEqual(d.palette, { label: 'Hold', category: 'Control flow' })
})

test('a chain file with a hold round-trips byte-identically', () => {
  const raw = serializeChain({ name: 'held' }, [
    { id: 'seed', kind: 'seed', pos: [0, 0] },
    { id: 'h', kind: 'hold', prompt: 'pick a verdict, then direct', pos: [200, 0] },
  ], [seedToHold])
  const parsed = parseChainContent(raw, 'held')
  const hold = parsed.nodes.find(n => n.id === 'h')!
  assert.strictEqual(hold.kind, 'hold')
  assert.strictEqual(hold.kind === 'hold' && hold.prompt, 'pick a verdict, then direct')
  assert.deepStrictEqual(hold.pos, [200, 0])
  assert.strictEqual(serializeChain(chainMeta(parsed), parsed.nodes, parsed.edges), raw)
})

test('a wired hold outside any zone or subchain is valid', () => {
  const c = chain('ok', [{ id: 'seed', kind: 'seed' }, { id: 'h', kind: 'hold' }], [seedToHold])
  const res = validateChain(c, [], [c])
  assert.deepStrictEqual(res.errors, [])
})

test('a hold with `in` unwired is a node-level error', () => {
  const res = validateChain(chain('c', [{ id: 'h', kind: 'hold' }]), [], [])
  assert.strictEqual(res.valid, false)
  assert.ok(res.issues.some(i => i.severity === 'error' && i.nodeId === 'h' && /hold/.test(i.message) && /in/.test(i.message)))
})

test('a hold inside a loop zone is a node-level error', () => {
  const c = chain('c', [
    { id: 'seed', kind: 'seed' },
    { id: 'ls', kind: 'loop-start', zone: 'z', state: [] },
    { id: 'h', kind: 'hold', zone: 'z' },
    { id: 'le', kind: 'loop-end', zone: 'z', until: 'x', maxIterations: 2 },
  ], [seedToHold])
  const res = validateChain(c, [], [])
  assert.ok(res.issues.some(i => i.severity === 'error' && i.nodeId === 'h' && /loop zone/.test(i.message)))
})

test('a hold in a chain another chain uses as a subchain errors on the hold', () => {
  const inner = chain('inner', [{ id: 'seed', kind: 'seed' }, { id: 'h', kind: 'hold' }], [seedToHold])
  const outer = chain('outer', [{ id: 's', kind: 'subchain', subchain: 'inner' }])
  const res = validateChain(inner, [], [inner, outer])
  assert.ok(res.issues.some(i => i.severity === 'error' && i.nodeId === 'h' && /subchain/.test(i.message) && /outer/.test(i.message)))
})

test('a subchain node pointing at a chain with a hold, at any depth, errors on the subchain node', () => {
  const inner = chain('inner', [{ id: 'seed', kind: 'seed' }, { id: 'h', kind: 'hold' }], [seedToHold])
  const middle = chain('middle', [{ id: 'm', kind: 'subchain', subchain: 'inner' }])
  const outer = chain('outer', [{ id: 's', kind: 'subchain', subchain: 'middle' }])
  const res = validateChain(outer, [], [inner, middle, outer])
  assert.ok(res.issues.some(i => i.severity === 'error' && i.nodeId === 's' && /hold/.test(i.message)))
})
