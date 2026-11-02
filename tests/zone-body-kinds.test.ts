import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { parseChainContent } from '../lib/parseChain'
import { validateChain } from '../lib/chainGraph'
import { allKinds, kindOf, paletteGroups } from '../lib/nodeKinds'
import type { AgentDef, ChainDef, ChainNode } from '../lib/types'

const agent: AgentDef = {
  slug: 'w', name: 'w', model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [],
  systemPrompt: 'Do {x}', filePath: '',
}

function zoned(body: ChainNode): ChainDef {
  return {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'ls', kind: 'loop-start', zone: 'z', state: [] },
      { id: 'w1', kind: 'agent', agent: 'w', zone: 'z', inputs: { x: 'v' } },
      body,
      { id: 'le', kind: 'loop-end', zone: 'z', until: 'always', maxIterations: 2 },
    ],
    edges: [],
  }
}

const bodies: ChainNode[] = [
  { id: 'n', kind: 'gate', condition: 'always', zone: 'z' },
  { id: 'n', kind: 'branch', cases: [{ label: 'a', condition: 'always' }], zone: 'z' },
  { id: 'n', kind: 'report', zone: 'z' },
  { id: 'n', kind: 'subchain', subchain: 'other', zone: 'z' },
]

test.each(bodies)('a $kind inside a zone fails validation, naming the node and the zone', body => {
  const res = validateChain(zoned(body), { agents: [agent] })
  const hit = res.issues.find(i => i.severity === 'error' && i.nodeId === 'n' && i.zone === 'z')
  assert.ok(hit, `no zone error for ${body.kind}: ${res.errors.join(' | ')}`)
  assert.ok(hit.message.includes('"n"') && hit.message.includes('"z"') && hit.message.includes(body.kind), hit.message)
})

test('agent and decider are the only zone body kinds', () => {
  assert.deepStrictEqual(allKinds.filter(k => kindOf(k).zoneRole === 'body'), ['agent', 'decider'])
  assert.deepStrictEqual(allKinds.filter(k => kindOf(k).zoneRole === 'boundary'), ['loop-start', 'loop-end'])
})

test('agent and decider are the only literal-capable kinds', () => {
  assert.deepStrictEqual(allKinds.filter(k => kindOf(k).acceptsLiterals), ['agent', 'decider'])
})

test('an agent body in a zone still validates', () => {
  const res = validateChain(zoned({ id: 'n', kind: 'decider', agent: 'w', zone: 'z', inputs: { x: 'v' } }), { agents: [agent] })
  assert.ok(!res.errors.some(e => /zone/i.test(e)), res.errors.join(' | '))
})

test('the palette groups by category in descriptor order, and shows a category no list names', () => {
  const items = [
    { category: 'Late', order: 90, label: 'z' },
    { category: 'A', order: 20, label: 'b' },
    { category: 'B', order: 10, label: 'c' },
    { category: 'A', order: 21, label: 'd' },
  ]
  assert.deepStrictEqual(
    paletteGroups(items).map(g => [g.category, g.items.map(i => i.label)]),
    [['B', ['c']], ['A', ['b', 'd']], ['Late', ['z']]],
  )
  assert.deepStrictEqual(
    paletteGroups(allKinds.map(k => kindOf(k).palette).filter(p => p !== undefined)).map(g => g.category),
    ['Sources', 'Agents', 'Control flow', 'Composite', 'Output'],
  )
})

test('no chain on disk places a non-body kind in a zone', () => {
  const dir = path.join(process.cwd(), 'workspace', 'chains')
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const chain = parseChainContent(fs.readFileSync(path.join(dir, file), 'utf8'), file.replace(/\.md$/, ''))
    const stray = chain.nodes.filter(n => n.zone && kindOf(n.kind).zoneRole === 'none').map(n => n.id)
    assert.deepStrictEqual(stray, [], `${file}: ${stray.join(', ')}`)
  }
})
