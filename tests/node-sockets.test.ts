import assert from 'node:assert'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { ChainDef, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string, outputs = [{ name: 'output' }]): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs, inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('writer', 'Write {topic} for {audience}', [{ name: 'output' }, { name: 'Summary' }])]

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'w', kind: 'agent', agent: 'writer' },
    { id: 'g', kind: 'gate', condition: 'x' },
    { id: 'b', kind: 'branch', cases: [{ label: 'urgent', condition: 'x' }], default: 'other' },
    { id: 'ls', kind: 'loop-start', zone: 'z1', state: ['draft'] },
    { id: 'le', kind: 'loop-end', zone: 'z1', until: 'x', maxIterations: 3 },
  ],
  edges: [],
}

// agent inputs = prompt slots; outputs = output + declared (slugified)
assert.deepStrictEqual(inputSocketsOf(chain.nodes[1], chain, agents), ['topic', 'audience'])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[1], chain, agents), ['output', 'summary'])
// seed
assert.deepStrictEqual(inputSocketsOf(chain.nodes[0], chain, agents), [])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[0], chain, agents), ['output'])
// gate
assert.deepStrictEqual(inputSocketsOf(chain.nodes[2], chain, agents), ['in'])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[2], chain, agents), ['output'])
// branch outputs = case labels + default
assert.deepStrictEqual(outputSocketsOf(chain.nodes[3], chain, agents), ['urgent', 'other'])
// loop-end inherits state from its zone's loop-start
assert.deepStrictEqual(inputSocketsOf(chain.nodes[5], chain, agents), ['draft'])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[5], chain, agents), ['draft'])

console.log('✅ node-sockets tests passed')
