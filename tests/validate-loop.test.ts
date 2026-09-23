import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain, issuesByNode } from '../lib/chainGraph'
import { ChainDef, AgentDef, ZoneStateEntry } from '../lib/types'

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
  assert.strictEqual(validateChain(good, { agents }).valid, true)

  // missing loop-end -> attached to loop-start nodeId
  const noEnd = chain(good.nodes.filter(n => n.id !== 'le'), good.edges.filter(e => e.toNode !== 'le' && e.fromNode !== 'le'))
  const noEndRes = validateChain(noEnd, { agents })
  assert.ok(noEndRes.errors.some(e => /loop-end/i.test(e)))
  assert.ok(noEndRes.issues.some(i => i.nodeId === 'ls' && i.message === 'Loop start "ls" in zone "r" is missing a paired loop-end'))
  assert.ok(issuesByNode(noEndRes.issues).has('ls'), 'issuesByNode maps orphan loop-start for border warning')

  // missing loop-start -> attached to loop-end nodeId
  const noStart = chain(good.nodes.filter(n => n.id !== 'ls'), good.edges.filter(e => e.toNode !== 'ls' && e.fromNode !== 'ls'))
  const noStartRes = validateChain(noStart, { agents })
  assert.ok(noStartRes.issues.some(i => i.nodeId === 'le' && i.message === 'Loop end "le" in zone "r" is missing a paired loop-start'))
  assert.ok(issuesByNode(noStartRes.issues).has('le'), 'issuesByNode maps orphan loop-end for border warning')

  // empty or missing zone on loop boundaries -> attached to respective nodeId
  const emptyZone = chain(
    good.nodes.map(n => n.id === 'ls' ? { ...n, zone: '' } : n.id === 'le' ? { ...n, zone: undefined } : n),
    good.edges,
  )
  const emptyRes = validateChain(emptyZone, { agents })
  assert.ok(emptyRes.issues.some(i => i.nodeId === 'ls' && i.message === 'Node "ls": loop-start has no zone'))
  assert.ok(emptyRes.issues.some(i => i.nodeId === 'le' && i.message === 'Node "le": loop-end has no zone'))
  assert.ok(issuesByNode(emptyRes.issues).has('ls') && issuesByNode(emptyRes.issues).has('le'))

  // duplicate loop-starts/ends -> attached to duplicate nodeIds
  const dupStarts = chain(
    [...good.nodes, { id: 'ls2', kind: 'loop-start', zone: 'r', state: [] }],
    good.edges,
  )
  const dupRes = validateChain(dupStarts, { agents })
  assert.ok(dupRes.issues.some(i => i.nodeId === 'ls' && /duplicate loop-start/i.test(i.message)))
  assert.ok(dupRes.issues.some(i => i.nodeId === 'ls2' && /duplicate loop-start/i.test(i.message)))
  assert.ok(issuesByNode(dupRes.issues).has('ls') && issuesByNode(dupRes.issues).has('ls2'))

  // bad maxIterations
  const badMax = chain(good.nodes.map(n => n.id === 'le' ? { ...n, maxIterations: 0 } : n), good.edges)
  assert.ok(validateChain(badMax, { agents }).errors.some(e => /maxIterations/i.test(e)))

  // boundary-crossing edge (outside node -> body node, not via loop-start)
  const cross = chain(good.nodes, [...good.edges, { fromNode: 'seed', fromSocket: 'output', toNode: 'review', toSocket: 'draft' }])
  assert.ok(validateChain(cross, { agents }).errors.some(e => /zone boundary/i.test(e)))
})

test('only accumulating loop-end state accepts several incoming edges', () => {
  const speaker: AgentDef = {
    slug: 'speaker', name: 'speaker', model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [],
    systemPrompt: '{transcript}', filePath: '',
  }
  const makeChain = (state: ZoneStateEntry): ChainDef => ({
    slug: 'conversation', name: 'conversation', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'ls', kind: 'loop-start', zone: 'scene', state: [state] },
      { id: 'a', kind: 'agent', agent: 'speaker', zone: 'scene' },
      { id: 'b', kind: 'agent', agent: 'speaker', zone: 'scene' },
      { id: 'le', kind: 'loop-end', zone: 'scene', until: 'NEVER', maxIterations: 3 },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'ls', toSocket: 'transcript' },
      { fromNode: 'ls', fromSocket: 'transcript', toNode: 'a', toSocket: 'transcript' },
      { fromNode: 'ls', fromSocket: 'transcript', toNode: 'b', toSocket: 'transcript' },
      { fromNode: 'a', fromSocket: 'output', toNode: 'le', toSocket: 'transcript' },
      { fromNode: 'b', fromSocket: 'output', toNode: 'le', toSocket: 'transcript' },
    ],
  })

  assert.strictEqual(validateChain(makeChain({ name: 'transcript', accumulate: true }), { agents: [speaker] }).valid, true)
  assert.ok(validateChain(makeChain('transcript'), { agents: [speaker] }).errors.some(error => /only one allowed/i.test(error)))
})
