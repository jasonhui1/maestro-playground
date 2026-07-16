import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { ChainDef, AgentDef, ChainNode } from '../lib/types'

const agent = (slug: string, prompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'),
                agent('w3', 'W3: {task}'), agent('syn', 'SYN: {in}')]

const joinNode: ChainNode = { id: 'j', kind: 'join' }

// sockets
assert.deepStrictEqual(inputSocketsOf(joinNode, {} as ChainDef, agents), ['in'])
assert.deepStrictEqual(outputSocketsOf(joinNode, {} as ChainDef, agents), ['output'])

// a join legally accepts N incoming edges into `in`
const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
    { id: 'j', kind: 'join' },
    { id: 'ns', kind: 'agent', agent: 'syn' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n1', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n2', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n3', toSocket: 'task' },
    { fromNode: 'n1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'j', fromSocket: 'output', toNode: 'ns', toSocket: 'in' },
  ],
}
const res = validateChain(chain, agents)
assert.ok(res.valid, 'join accepts 3 edges into `in`: ' + res.errors.join('; '))

// negative control: a NON-join slot with 2 edges still errors
const bad: ChainDef = {
  ...chain,
  edges: [...chain.edges, { fromNode: 'n1', fromSocket: 'output', toNode: 'ns', toSocket: 'in' }],
}
const badRes = validateChain(bad, agents)
assert.ok(!badRes.valid && badRes.errors.some(e => /only one allowed/.test(e)),
  'a normal slot still rejects a 2nd edge')

// warning: a join with no incoming edges
const lonely: ChainDef = {
  slug: 'c2', name: 'c2', description: '', filePath: '',
  nodes: [{ id: 'j', kind: 'join' }], edges: [],
}
assert.ok(validateChain(lonely, agents).issues.some(i => i.severity === 'warning' && /no incoming/.test(i.message)),
  'unwired join warns')

console.log('✅ join graph tests passed')
