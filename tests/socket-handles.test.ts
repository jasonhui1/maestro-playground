import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { socketHandles } from '../lib/nodeSockets'
import { allKinds, kindOf } from '../lib/nodeKinds'
import { ChainDef, ChainNode, ChainNodeKind, AgentDef } from '../lib/types'

const writer: AgentDef = {
  slug: 'writer', name: 'writer', model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown',
  outputs: [{ name: 'output' }, { name: 'Summary' }], inputs: [],
  systemPrompt: 'Write {topic} for {audience}', filePath: '',
}

const inner: ChainDef = {
  slug: 'inner', name: 'inner', description: '', filePath: '', nodes: [], edges: [],
  inputs: [{ name: 'brief', node: 'seed' }, { name: 'tone', node: 'seed' }],
  outputs: [{ name: 'draft', node: 'w' }],
}

// One node of every kind, each carrying the data its sockets are derived from.
const nodes: Record<ChainNodeKind, ChainNode> = {
  seed: { id: 'seed', kind: 'seed' },
  context: { id: 'ctx', kind: 'context', file: 'lore' },
  param: { id: 'p', kind: 'param' },
  agent: { id: 'w', kind: 'agent', agent: 'writer' },
  decider: { id: 'd', kind: 'decider', agent: 'writer' },
  gate: { id: 'g', kind: 'gate', condition: 'x' },
  branch: { id: 'b', kind: 'branch', cases: [{ label: 'urgent', condition: 'x' }], default: 'other' },
  'loop-start': { id: 'ls', kind: 'loop-start', zone: 'z1', state: ['draft'] },
  'loop-end': { id: 'le', kind: 'loop-end', zone: 'z1', until: 'x', maxIterations: 3 },
  subchain: { id: 'sub', kind: 'subchain', subchain: 'inner' },
  report: { id: 'r', kind: 'report' },
  join: { id: 'j', kind: 'join' },
  hold: { id: 'h', kind: 'hold' },
}

// What the canvas must draw for each node above, written out rather than re-derived —
// a registry change that moves or drops a socket has to be seen here too (#114).
const expected: Record<ChainNodeKind, string[]> = {
  seed: ['output:output'],
  context: ['output:output'],
  param: ['output:output'],
  agent: ['input:topic', 'input:audience', 'output:output', 'output:summary'],
  decider: ['input:topic', 'input:audience', 'output:output', 'output:summary'],
  gate: ['input:in', 'output:output'],
  branch: ['input:in', 'output:urgent', 'output:other'],
  'loop-start': ['input:draft', 'output:draft'],
  'loop-end': ['input:draft', 'output:draft'],
  subchain: ['input:brief', 'input:tone', 'output:draft'],
  report: ['input:in'],
  join: ['input:in', 'output:output'],
  hold: ['input:in', 'output:output'],
}

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: Object.values(nodes), edges: [],
}
const workspace = { chain, agents: [writer], chains: [inner] }
const drawn = (kind: ChainNodeKind) => socketHandles(nodes[kind], workspace).map(h => `${h.side}:${h.id}`)

test('every declared socket has a handle, and every handle a declared socket', () => {
  assert.deepStrictEqual(allKinds.filter(k => !nodes[k]), [], 'the fixture must cover every kind')

  for (const kind of allKinds) {
    // the handles are the ones this kind is supposed to have...
    assert.deepStrictEqual(drawn(kind), expected[kind], `${kind}: unexpected handles`)
    // ...and they are exactly what the live registry declares, in declared order
    const descriptor = kindOf(kind)
    assert.deepStrictEqual(drawn(kind), [
      ...descriptor.inputs(nodes[kind], workspace).map(s => `input:${s.name}`),
      ...descriptor.outputs(nodes[kind], workspace).map(name => `output:${name}`),
    ], `${kind}: handles drifted from the registry`)
  }
})

test('a socket the node does not declare yet gets no handle', () => {
  // a branch with no cases and no default has one input and nothing to branch to
  assert.deepStrictEqual(
    socketHandles({ id: 'b2', kind: 'branch' }, workspace).map(h => `${h.side}:${h.id}`),
    ['input:in'],
  )
  // a loop-start whose zone is unnamed has no state to expose
  assert.deepStrictEqual(socketHandles({ id: 'ls2', kind: 'loop-start', state: ['draft'] }, workspace), [])
  // an agent with no agent picked has no prompt slots, but still answers with `output`
  assert.deepStrictEqual(
    socketHandles({ id: 'w2', kind: 'agent' }, workspace).map(h => `${h.side}:${h.id}`),
    ['output:output'],
  )
})

test('optional and multi-input facts survive the trip to the handle', () => {
  // subchain inputs are optional — an unwired one is not an error
  const sub = socketHandles(nodes.subchain, workspace)
  assert.deepStrictEqual(
    sub.filter(h => h.side === 'input').map(h => [h.id, h.optional === true]),
    [['brief', true], ['tone', true]],
  )
  assert.strictEqual(sub.every(h => !h.multi), true, 'subchain slots take one edge each')

  // join is the one kind whose input slot accepts N incoming edges
  const join = socketHandles(nodes.join, workspace)
  assert.deepStrictEqual(join.filter(h => h.side === 'input').map(h => [h.id, h.multi === true]), [['in', true]])
  assert.strictEqual(join.every(h => !h.optional), true)

  const accumulatingStart: ChainNode = {
    id: 'ls', kind: 'loop-start', zone: 'z1',
    state: ['draft', { name: 'transcript', accumulate: true }],
  }
  const accumulatingWorkspace = {
    ...workspace,
    chain: { ...chain, nodes: Object.values({ ...nodes, 'loop-start': accumulatingStart }) },
  }
  const loopEnd = socketHandles(nodes['loop-end'], accumulatingWorkspace).filter(h => h.side === 'input')
  assert.deepStrictEqual(loopEnd.map(h => [h.id, h.multi === true]), [['draft', false], ['transcript', true]])

  // every other kind's inputs are required and single
  assert.strictEqual(
    socketHandles(nodes.agent, workspace).every(h => !h.optional && !h.multi),
    true,
  )
})

test('only the socket seam renders handles', () => {
  const dir = path.join(__dirname, '..', 'components', 'editor')
  const seam = path.join(dir, 'nodes', 'Sockets.tsx')
  const files: string[] = []
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const full = path.join(d, e.name)
    if (e.isDirectory()) walk(full)
    else if (e.name.endsWith('.tsx') && full !== seam) files.push(full)
  })
  walk(dir)

  const offenders = files
    .filter(f => /<Handle[\s/>]/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(dir, f))
  assert.deepStrictEqual(offenders, [], 'these must render sockets through nodes/Sockets.tsx')
  assert.ok(files.length > 10, 'the scan must actually reach the node components')
})
