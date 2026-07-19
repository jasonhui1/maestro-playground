import assert from 'node:assert'
import { kindOf } from '../lib/nodeKinds'
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
const workspace = { chain, agents, chains: [] }
const namesOf = (node: typeof chain.nodes[number]) => kindOf(node.kind).inputs(node, workspace).map(s => s.name)

// agent inputs = prompt slots; outputs = output + declared (slugified)
assert.deepStrictEqual(namesOf(chain.nodes[1]), ['topic', 'audience'])
assert.deepStrictEqual(kindOf('agent').outputs(chain.nodes[1], workspace), ['output', 'summary'])
// seed
assert.deepStrictEqual(namesOf(chain.nodes[0]), [])
assert.deepStrictEqual(kindOf('seed').outputs(chain.nodes[0], workspace), ['output'])
// gate
assert.deepStrictEqual(namesOf(chain.nodes[2]), ['in'])
assert.deepStrictEqual(kindOf('gate').outputs(chain.nodes[2], workspace), ['output'])
// branch outputs = case labels + default
assert.deepStrictEqual(kindOf('branch').outputs(chain.nodes[3], workspace), ['urgent', 'other'])
// loop-end inherits state from its zone's loop-start
assert.deepStrictEqual(namesOf(chain.nodes[5]), ['draft'])
assert.deepStrictEqual(kindOf('loop-end').outputs(chain.nodes[5], workspace), ['draft'])

console.log('✅ node-sockets tests passed')
