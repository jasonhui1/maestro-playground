import { test, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { parseChainContent } from '../lib/parseChain'
import { validateChain } from '../lib/chainGraph'
import { runChainGraph } from '../lib/executor'
import { allKinds, kindOf, paletteGroups } from '../lib/nodeKinds'
import type { AgentDef, ChainDef, ChainNode, ToolDef } from '../lib/types'

vi.mock('../lib/tools/retrieveExecutor', () => ({ retrieveExecutor: () => 'ran' }))

const agent: AgentDef = {
  slug: 'w', name: 'w', model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [],
  systemPrompt: 'Do {x}', filePath: '',
}
const tool: ToolDef = { slug: 't', name: 't', executor: 'retrieve', params: {}, config: {}, description: '', filePath: '' }

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
    'categories sort by order',
  )
  assert.deepStrictEqual(
    paletteGroups([items[3], items[1]]).map(g => g.items.map(i => i.label)),
    [['d', 'b']],
    'items keep the order given, so a search ranking survives',
  )
  assert.deepStrictEqual(
    paletteGroups(allKinds.map(k => kindOf(k).palette).filter(p => p !== undefined)).map(g => g.category),
    ['Sources', 'Agents', 'Tools', 'Control flow', 'Composite', 'Output'],
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

test('every zone body kind actually runs inside a zone', async () => {
  const run = (async (a: AgentDef, sp: string) => ({ agentName: a.name, systemPrompt: sp, input: '', output: 'ran',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' })) as never
  for (const kind of allKinds.filter(k => kindOf(k).zoneRole === 'body')) {
    const body = kind === 'tool' ? { id: 'n', kind, tool: 't', zone: 'z' } : { id: 'n', kind, agent: 'w', zone: 'z', inputs: { x: 'v' } }
    const chain = zoned(body as ChainNode)
    const res = await runChainGraph(chain, { agents: [agent], tools: [tool], root: '/ws' },
      { onStart() {}, onToken() {}, onDone() {} }, { seedPrompt: 's', run })
    assert.strictEqual(res.find(o => o.nodeId === 'n')?.status, 'success', `${kind} did not run in a zone`)
  }
})
