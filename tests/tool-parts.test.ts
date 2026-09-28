import { test } from 'vitest'
import assert from 'node:assert'
import { parseTool } from '../lib/fs/parseTool'
import { parseChainContent } from '../lib/parseChain'
import { bindAgentTools } from '../lib/tools/registry'
import { socketHandles } from '../lib/nodeSockets'
import { validateChain } from '../lib/chainGraph'
import { resolveParts } from '../lib/tools/parts'
import type { AgentDef } from '../lib/types'

const tool = parseTool('/w/tools/novelai.md', [
  '---', 'executor: novelai',
  'params:', '  aspect:', '    type: string',
  'parts:',
  '  character:',
  '  clothes: red cloak',
  '  scene:', '    description: Where it happens.',
  '  style: ""',
  '---', 'Draw.', '',
].join('\n'))

const painter: AgentDef = {
  slug: 'painter', name: 'painter', model: 'm', description: '', skills: [], context: [], tools: ['novelai'],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: 'Paint {input}.', filePath: '',
}

test('parts parse in order: empty is open, text is a default, an object may carry both', () => {
  assert.deepStrictEqual(tool.parts, [
    { name: 'character' },
    { name: 'clothes', default: 'red cloak' },
    { name: 'scene', description: 'Where it happens.' },
    { name: 'style', default: '' },
  ])
  const bad = (parts: string) => () => parseTool('/w/tools/x.md', `---\nexecutor: novelai\nparams:\n  aspect:\n    type: string\nparts:\n${parts}\n---\n`)
  assert.throws(bad('  aspect: x'), /same name as a param/)
  assert.throws(bad('  "a.b": x'), /letters, digits/)
  assert.throws(bad('  x: [1]'), /must be text/)
})

test('the model is asked only for open parts; fixed ones never reach it', () => {
  const [open] = bindAgentTools(painter, [tool], { workspacePath: '' })
  assert.deepStrictEqual(Object.keys(open.jsonSchema.properties), ['aspect', 'character', 'scene'])
  assert.deepStrictEqual(open.jsonSchema.required, ['character', 'scene'])
  assert.strictEqual(open.jsonSchema.properties.scene.description, 'Where it happens.')

  const [fixed] = bindAgentTools(painter, [tool], { workspacePath: '', fixedParts: { novelai: { character: '1girl', clothes: 'kimono' } } })
  assert.deepStrictEqual(Object.keys(fixed.jsonSchema.properties), ['aspect', 'scene'])
})

test('a part resolves node-fixed, else default, else what the model passed', () => {
  assert.deepStrictEqual(
    resolveParts(tool.parts!, { clothes: 'kimono' }, { character: ' 1girl ', clothes: 'ignored', scene: 'garden', style: 'ignored' }),
    [
      { name: 'character', value: '1girl' },
      { name: 'clothes', value: 'kimono' },
      { name: 'scene', value: 'garden' },
      { name: 'style', value: '' },
    ],
  )
})

test('each part is an optional input socket on a node whose agent uses the tool', () => {
  const chain = parseChainContent([
    '---', 'name: c', 'nodes:',
    '  - id: seed', '    kind: seed',
    '  - id: paint', '    kind: agent', '    agent: painter', '    inputs:', '      novelai.clothes: kimono',
    'edges:',
    '  - from: seed.output', '    to: paint.input',
    '  - from: seed.output', '    to: paint.novelai.character',
    '---', '',
  ].join('\n'), 'c')
  const node = chain.nodes.find(n => n.id === 'paint')!
  assert.deepStrictEqual(
    socketHandles(node, { chain, agents: [painter], chains: [], tools: [tool] }).filter(h => h.side === 'input'),
    [
      { id: 'input', side: 'input' },
      { id: 'novelai.character', side: 'input', optional: true },
      { id: 'novelai.clothes', side: 'input', optional: true },
      { id: 'novelai.scene', side: 'input', optional: true },
      { id: 'novelai.style', side: 'input', optional: true },
    ],
  )
  assert.deepStrictEqual(validateChain(chain, { agents: [painter], tools: [tool] }).errors, [])
  // without the tool the part sockets don't exist, so the same wiring is refused
  assert.ok(validateChain(chain, { agents: [painter], tools: [] }).errors.some(e => /novelai\.character/.test(e)))
})
