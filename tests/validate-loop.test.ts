import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef } from '../lib/types'

test('validate-loop', () => {
  function agent(slug: string, prompt: string): AgentDef {
    return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
      input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
  }
  const agents = [agent('patch', 'Prev: {previous}\nFb: {feedback}'), agent('review', 'Draft: {draft}'), agent('rep', 'Final: {in}')]

  function chain(nodes: ChainDef['nodes'], edges: ChainDef['edges']): ChainDef {
    return { slug: 'c', name: 'c', description: '', nodes, edges, filePath: '' }
  }
  const good = chain(
    [
      { id: 'seed', kind: 'seed' },
      { id: 'ls', kind: 'loop-start', zone: 'r', state: ['draft', 'feedback'] },
      { id: 'patch', kind: 'agent', agent: 'patch', zone: 'r' },
      { id: 'review', kind: 'agent', agent: 'review', zone: 'r' },
      { id: 'le', kind: 'loop-end', zone: 'r', until: '{review.output} contains "OK"', maxIterations: 3 },
      { id: 'rep', kind: 'agent', agent: 'rep' },
    ],
    [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'ls', toSocket: 'draft' },
      { fromNode: 'ls', fromSocket: 'draft', toNode: 'patch', toSocket: 'previous' },
      { fromNode: 'ls', fromSocket: 'feedback', toNode: 'patch', toSocket: 'feedback' },
      { fromNode: 'patch', fromSocket: 'output', toNode: 'review', toSocket: 'draft' },
      { fromNode: 'patch', fromSocket: 'output', toNode: 'le', toSocket: 'draft' },
      { fromNode: 'review', fromSocket: 'output', toNode: 'le', toSocket: 'feedback' },
      { fromNode: 'le', fromSocket: 'draft', toNode: 'rep', toSocket: 'in' },
    ],
  )
  assert.strictEqual(validateChain(good, agents).valid, true)

  // missing loop-end
  const noEnd = chain(good.nodes.filter(n => n.id !== 'le'), good.edges.filter(e => e.toNode !== 'le' && e.fromNode !== 'le'))
  assert.ok(validateChain(noEnd, agents).errors.some(e => /loop-end/i.test(e)))

  // bad maxIterations
  const badMax = chain(good.nodes.map(n => n.id === 'le' ? { ...n, maxIterations: 0 } : n), good.edges)
  assert.ok(validateChain(badMax, agents).errors.some(e => /maxIterations/i.test(e)))

  // boundary-crossing edge (outside node -> body node, not via loop-start)
  const cross = chain(good.nodes, [...good.edges, { fromNode: 'seed', fromSocket: 'output', toNode: 'review', toSocket: 'draft' }])
  assert.ok(validateChain(cross, agents).errors.some(e => /zone boundary/i.test(e)))
})
