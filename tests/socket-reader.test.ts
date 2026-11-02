import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { buildLayoutModel } from '../lib/layoutModel'
import { evalCondition } from '../lib/condition'
import { readSocket, refReader } from '../lib/resolveNode'
import { reviseOutput } from '../lib/revision'
import { socketHandles } from '../lib/nodeSockets'
import { type NodeKindDescriptor } from '../lib/nodeKinds'
import type { AgentDef, AgentOutput, ChainDef, ChainNode, RunDice } from '../lib/types'

const agent = (slug: string, systemPrompt: string, extra: Partial<AgentDef> = {}): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [], inputs: [], systemPrompt, filePath: '', ...extra,
})
const record = (nodeId: string, output: string): AgentOutput => ({
  nodeId, agentName: nodeId, systemPrompt: '', input: '', output,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})
// Echoes the resolved prompt, so a reader's output is exactly what its edge delivered.
const echo = async (a: AgentDef, systemPrompt: string): Promise<AgentOutput> => record('', systemPrompt)
const noop = { onStart() {}, onToken() {}, onDone() {} }
const delivered = (results: AgentOutput[], nodeId: string): string =>
  results.filter(r => r.nodeId === nodeId).at(-1)!.output.replace(/^IN=/, '')

const inner: ChainDef = {
  slug: 'inner', name: 'Inner', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'w' }],
  edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'w', toSocket: 'x' }],
  inputs: [{ name: 'brief', node: 'seed' }],
  outputs: [{ name: 'Hop 1', node: 'w', socket: 'pitch' }],
}
const chain: ChainDef = {
  slug: 'outer', name: 'Outer', description: '', filePath: '', view: 'timeline',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'sub', kind: 'subchain', subchain: 'inner' },
    { id: 'ls', kind: 'loop-start', zone: 'z', state: ['draft'] },
    { id: 'patch', kind: 'agent', agent: 'patch', zone: 'z' },
    { id: 'le', kind: 'loop-end', zone: 'z', until: '{patch.output} contains "round"', maxIterations: 2 },
    { id: 'fromSub', kind: 'agent', agent: 'reader' },
    { id: 'fromLoop', kind: 'agent', agent: 'reader' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'brief' },
    { fromNode: 'sub', fromSocket: 'Hop 1', toNode: 'ls', toSocket: 'draft' },
    { fromNode: 'ls', fromSocket: 'draft', toNode: 'patch', toSocket: 'prev' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'le', toSocket: 'draft' },
    { fromNode: 'sub', fromSocket: 'Hop 1', toNode: 'fromSub', toSocket: 'in' },
    { fromNode: 'le', fromSocket: 'draft', toNode: 'fromLoop', toSocket: 'in' },
  ],
  outputs: [
    { name: 'sub port', node: 'sub', socket: 'Hop 1' },
    { name: 'loop state', node: 'le', socket: 'draft' },
  ],
}
const agents = [
  agent('w', '## Pitch\nPitched {x}\n\n## Notes\naside'),
  agent('patch', 'round over {prev}'),
  agent('reader', 'IN={in}'),
]
const defs = { agents, chains: [inner], root: '/tmp' }

test('a panel on a subchain port or a loop-end state shows exactly what the edge delivered', async () => {
  const results = await runChainGraph(chain, defs, noop, { seedPrompt: 'SEED', run: echo })
  const [subPanel, loopPanel] = buildLayoutModel(chain, results).panels

  assert.strictEqual(delivered(results, 'fromSub'), 'Pitched SEED')
  assert.strictEqual(subPanel.text, delivered(results, 'fromSub'))
  assert.strictEqual(subPanel.state, 'filled')
  assert.strictEqual(loopPanel.text, delivered(results, 'fromLoop'))
  assert.strictEqual(loopPanel.text, 'round over Pitched SEED')
})

test('a replayed subchain port still reaches its edge when the port name is not a slug', async () => {
  const first = await runChainGraph(chain, defs, noop, { seedPrompt: 'SEED', run: echo })
  const replay = first.filter(r => r.nodeId !== 'fromSub')
  const again = await runChainGraph(chain, defs, noop, { seedPrompt: 'SEED', run: echo, replay })
  assert.strictEqual(delivered(again, 'fromSub'), 'Pitched SEED')
})

function conditionReader(nodes: ChainNode[], outputs: Map<string, AgentOutput>, run: { seed?: string; param?: string; dice?: RunDice } = {}) {
  return refReader(new Map(nodes.map(n => [n.id, n])), outputs, run.seed ?? '', () => '', run.param ?? '', run.dice ?? {})
}

test('a condition reading a nested section matches the edge reading of that section', () => {
  const w: ChainNode = { id: 'w', kind: 'agent', agent: 'w' }
  const outputs = new Map([['w', record('w', '## Act 2\n### Scene 3\nClimax reached\n## Act 2\n### Scene 3\nlater')]])
  const read = conditionReader([w], outputs)
  const edge = readSocket(w, 'Act 2/Scene 3', outputs, '', () => '').value

  assert.strictEqual(edge, 'Climax reached')
  assert.strictEqual(evalCondition(`{w.Act 2/Scene 3} == "${edge}"`, read), true)
  assert.strictEqual(evalCondition('exists {w.act-2/scene-99}', read), false)
})

test('a condition reads every kind the way its edge does', () => {
  const nodes: ChainNode[] = [
    { id: 'seed', kind: 'seed' },
    { id: 'p', kind: 'param' },
    { id: 'g', kind: 'gate', condition: '' },
    { id: 'd', kind: 'agent', agent: 'roller' },
  ]
  const outputs = new Map([['g', record('g', '## Verdict\nPASSED')], ['d', record('d', '## Dice\nnot the roll')]])
  const read = conditionReader(nodes, outputs, { seed: 'the seed', param: 'formal', dice: { d: { mood: ['calm'] } } })

  assert.strictEqual(evalCondition('{seed} == "the seed"', read), true)
  assert.strictEqual(evalCondition('{p} == "formal"', read), true)
  assert.strictEqual(evalCondition('{g.verdict} contains "## verdict"', read), true, 'a gate passes its whole output through')
  assert.strictEqual(evalCondition('{d.dice} == "- mood: calm"', read), true)
})

test('subchain ports and loop states are not sections on the canvas; agent sections and the dice roll are told apart', () => {
  const lookup = { chain, agents: [...agents, agent('roller', '{x}', { outputs: [{ name: 'Summary' }], dice: { mood: { values: ['calm'], draws: 1 } } })], chains: [inner] }
  const outputsOf = (node: ChainNode) =>
    Object.fromEntries(socketHandles(node, lookup).filter(h => h.side === 'output').map(h => [h.id, h.reads]))

  assert.deepStrictEqual(outputsOf(chain.nodes[1]), { 'Hop 1': 'keyed' })
  assert.deepStrictEqual(outputsOf(chain.nodes[4]), { draft: 'keyed' })
  assert.deepStrictEqual(outputsOf({ id: 'r', kind: 'agent', agent: 'roller' }), { output: 'whole', summary: 'section', dice: 'roll' })
  assert.deepStrictEqual(outputsOf({ id: 'b', kind: 'branch', cases: [{ label: 'yes', condition: '' }] }), { yes: 'whole' })
})

test('a panel address round-trips through an addressed revision', () => {
  const prop: ChainDef = {
    slug: 'p', name: 'p', description: '', filePath: '', view: 'timeline',
    nodes: [{ id: 'prop', kind: 'agent', agent: 'w' }], edges: [],
    outputs: [{ name: 'pitch', node: 'prop', socket: 'Pitch' }, { name: 'notes', node: 'prop', socket: 'notes' }],
  }
  const original = '## Pitch\nOriginal pitch.\n\n## Notes\nOriginal notes.'
  const panels = buildLayoutModel(prop, [record('prop', original)]).panels
  const revised = reviseOutput(original, panels.map(p => ({ socket: p.socket, text: `${p.name} edited`, was: p.text })))
  assert.ok('output' in revised, JSON.stringify(revised))

  const after = buildLayoutModel(prop, [record('prop', revised.output)]).panels
  assert.deepStrictEqual(after.map(p => p.text), ['pitch edited', 'notes edited'])

  // `Output` reads as the whole text on an edge, so it revises as the whole text too
  const whole = { ...prop, outputs: [{ name: 'all', node: 'prop', socket: 'Output' }] }
  const [all] = buildLayoutModel(whole, [record('prop', original)]).panels
  assert.strictEqual(all.text, original)
  assert.deepStrictEqual(reviseOutput(original, [{ socket: all.socket, text: 'replaced', was: all.text }]), { output: 'replaced' })
})

test('a kind with no read fact does not compile', () => {
  // @ts-expect-error `read` is required on every descriptor
  const missing: NodeKindDescriptor = {
    kind: 'seed', acceptsInputs: false, acceptsLiterals: false, zoneRole: 'none',
    inputs: () => [], outputs: () => ['output'], fields: [],
  }
  assert.ok(missing)
})
