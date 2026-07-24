import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef } from '../lib/types'

test('validate-control', () => {
  function agent(slug: string, prompt: string): AgentDef {
    return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
      input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
  }
  function chain(nodes: ChainDef['nodes'], edges: ChainDef['edges']): ChainDef {
    return { slug: 'c', name: 'c', description: '', nodes, edges, filePath: '' }
  }
  const agents = [agent('producer', 'Make: {input}'), agent('fast', 'Do: {in}'), agent('judge', 'Judge: {input}')]

  // valid: producer -> gate -> fast
  const good = chain(
    [
      { id: 'seed', kind: 'seed' },
      { id: 'p', kind: 'agent', agent: 'producer' },
      { id: 'g', kind: 'gate', condition: '{p.output} contains "OK"' },
      { id: 'f', kind: 'agent', agent: 'fast' },
    ],
    [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
      { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
      { fromNode: 'g', fromSocket: 'output', toNode: 'f', toSocket: 'in' },
    ],
  )
  assert.deepStrictEqual(validateChain(good, agents).valid, true)

  // gate without condition
  const noCond = chain(good.nodes.map(n => n.id === 'g' ? { ...n, condition: '' } : n), good.edges)
  assert.ok(validateChain(noCond, agents).errors.some(e => /gate.*condition/i.test(e)))

  // branch-out edge with unknown case label
  const br = chain(
    [
      { id: 'seed', kind: 'seed' },
      { id: 'p', kind: 'agent', agent: 'producer' },
      { id: 'b', kind: 'branch', cases: [{ label: 'a', condition: '{p.output} contains "A"' }], default: 'other' },
      { id: 'f', kind: 'agent', agent: 'fast' },
    ],
    [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
      { fromNode: 'p', fromSocket: 'output', toNode: 'b', toSocket: 'in' },
      { fromNode: 'b', fromSocket: 'zzz', toNode: 'f', toSocket: 'in' }, // zzz not a case/default
    ],
  )
  assert.ok(validateChain(br, agents).errors.some(e => /case/i.test(e)))

  // condition references an unknown node
  const badRef = chain(good.nodes.map(n => n.id === 'g' ? { ...n, condition: '{ghost.output} contains "x"' } : n), good.edges)
  assert.ok(validateChain(badRef, agents).errors.some(e => /ghost/i.test(e)))
})
