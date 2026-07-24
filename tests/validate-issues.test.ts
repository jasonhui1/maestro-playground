import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef } from '../lib/types'

test('validate-issues', () => {
  function agent(slug: string, prompt: string): AgentDef {
    return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
      input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
  }
  const agents = [agent('producer', 'Make: {input}'), agent('fast', 'Do: {in}')]

  // gate without condition -> issue carries nodeId 'g'
  const noCond: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'p', kind: 'agent', agent: 'producer' },
      { id: 'g', kind: 'gate', condition: '' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
      { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
    ],
  }
  const r = validateChain(noCond, agents)
  assert.strictEqual(r.valid, false)
  assert.ok(r.issues.some(i => i.nodeId === 'g' && /condition/i.test(i.message)))
  // errors string list still populated (back-compat)
  assert.ok(r.errors.some(e => /gate.*condition/i.test(e)))

  // bad edge socket -> issue carries the edge
  const badEdge: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [{ id: 'seed', kind: 'seed' }, { id: 'p', kind: 'agent', agent: 'producer' }],
    edges: [{ fromNode: 'seed', fromSocket: 'nope', toNode: 'p', toSocket: 'input' }],
  }
  const r2 = validateChain(badEdge, agents)
  assert.ok(r2.issues.some(i => i.edge && i.edge.fromSocket === 'nope'))

  // malformed zone -> issue carries zone id
  const badZone: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'ls', kind: 'loop-start', zone: 'z1', state: [] },
      // no loop-end for z1
    ],
    edges: [],
  }
  const r3 = validateChain(badZone, agents)
  assert.ok(r3.issues.some(i => i.zone === 'z1'))
})
