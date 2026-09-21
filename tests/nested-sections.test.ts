import { test } from 'vitest'
import assert from 'node:assert'
import { extractSection, extractSectionPath, parseSectionPath, scanHeadings } from '../lib/graph'
import { socketKey, outputKey, isWholeOutput, parseToken, endpointOf } from '../lib/tokens'
import { evalCondition } from '../lib/condition'
import { buildLayoutModel } from '../lib/layoutModel'
import { validateChain } from '../lib/chainGraph'
import { readSocket, resolveNodePrompt } from '../lib/resolveNode'
import { sectionWarningText, sameSectionWarning, type SectionWarning } from '../lib/sectionWarning'
import { runChainGraph } from '../lib/executor'
import { socketHandles } from '../lib/nodeSockets'
import type { AgentDef, AgentOutput, ChainDef, ChainNode } from '../lib/types'

function makeOutput(nodeId: string, text: string): AgentOutput {
  return {
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm',
    timestamp: '', status: 'success',
  }
}

const readCtx = (f: string) => `CTX:${f}`

test('parseSectionPath splits on / and normalizes segments', () => {
  assert.deepStrictEqual(parseSectionPath('act-2/scene-3'), ['act-2', 'scene-3'])
  assert.deepStrictEqual(parseSectionPath('Act 2 / Scene 3'), ['act-2', 'scene-3'])
  assert.deepStrictEqual(parseSectionPath('/act-2//scene-3/'), ['act-2', 'scene-3'])
  assert.deepStrictEqual(parseSectionPath(['Act 2', 'Scene 3']), ['act-2', 'scene-3'])
  assert.deepStrictEqual(parseSectionPath(''), [])
  assert.deepStrictEqual(parseSectionPath('///'), [])
})

test('extractSectionPath supports flat and nested paths', () => {
  const md = `Intro text
## Act 1
### Scene 1
Act 1 Scene 1 body
### Scene 3
Act 1 Scene 3 body
## Act 2
Act 2 introductory text
### Scene 1
Act 2 Scene 1 body
### Scene 3
Act 2 Scene 3 body
#### Beat A
Act 2 Scene 3 Beat A
## Act 3
End of play`

  // Flat heading lookup
  assert.strictEqual(extractSection(md, 'act-1'), '')
  assert.strictEqual(extractSection(md, 'Act 2'), 'Act 2 introductory text')
  assert.strictEqual(extractSection(md, 'missing'), '')

  // Scoped two-level lookup
  const act1Scene3 = extractSectionPath(md, 'act-1/scene-3')
  assert.strictEqual(act1Scene3.status, 'found')
  assert.strictEqual(act1Scene3.text, 'Act 1 Scene 3 body')
  assert.strictEqual(extractSection(md, 'act-1/scene-3'), 'Act 1 Scene 3 body')

  const act2Scene3 = extractSectionPath(md, 'act-2/scene-3')
  assert.strictEqual(act2Scene3.status, 'found')
  assert.strictEqual(act2Scene3.text, 'Act 2 Scene 3 body')
  assert.strictEqual(extractSection(md, 'act-2/scene-3'), 'Act 2 Scene 3 body')

  // Three-level lookup
  const beatA = extractSectionPath(md, 'act-2/scene-3/beat-a')
  assert.strictEqual(beatA.status, 'found')
  assert.strictEqual(beatA.text, 'Act 2 Scene 3 Beat A')
})

test('extractSectionPath preserves body-until-next-heading without whole subtree', () => {
  const md = `## Act 2
Introductory summary only.
### Scene 1
Scene 1 text`

  const act2 = extractSectionPath(md, 'act-2')
  assert.strictEqual(act2.status, 'found')
  assert.strictEqual(act2.text, 'Introductory summary only.')
})

test('extractSectionPath handles skipped heading levels', () => {
  const md = `## Act 2
##### Deep Scene
Content under skipped levels`

  const r = extractSectionPath(md, 'act-2/deep-scene')
  assert.strictEqual(r.status, 'found')
  assert.strictEqual(r.text, 'Content under skipped levels')
})

test('extractSectionPath reports ambiguous duplicate headings and picks first match', () => {
  const md = `## Act 2
### Scene 3
First version
### Scene 3
Second version`

  const r = extractSectionPath(md, 'act-2/scene-3')
  assert.strictEqual(r.status, 'ambiguous')
  assert.strictEqual(r.text, 'First version')
  assert.strictEqual(r.ambiguousSegment, 'scene-3')
  assert.strictEqual(extractSection(md, 'act-2/scene-3'), 'First version')
})

test('extractSectionPath reports duplicate top-level headings as ambiguous', () => {
  const md = `## Act 2
First Act
### Scene 1
Scene in first
## Act 2
Second Act
### Scene 1
Scene in second`

  const r = extractSectionPath(md, 'act-2/scene-1')
  assert.strictEqual(r.status, 'ambiguous')
  assert.strictEqual(r.text, 'Scene in first')
})

test('extractSectionPath distinguishes missing from empty leaf', () => {
  const md = `## Act 2
### Empty Scene

### Populated Scene
Some text`

  const missing = extractSectionPath(md, 'act-2/missing-scene')
  assert.strictEqual(missing.status, 'missing')
  assert.strictEqual(missing.text, '')
  assert.strictEqual(missing.missingSegment, 'missing-scene')

  const missingParent = extractSectionPath(md, 'missing-act/empty-scene')
  assert.strictEqual(missingParent.status, 'missing')
  assert.strictEqual(missingParent.missingSegment, 'missing-act')

  const empty = extractSectionPath(md, 'act-2/empty-scene')
  assert.strictEqual(empty.status, 'empty')
  assert.strictEqual(empty.empty, true)
  assert.strictEqual(empty.text, '')
})

test('extractSectionPath ignores headings inside fenced code blocks', () => {
  const md = `## Act 1
### Scene 1
\`\`\`markdown
## Act 2
### Scene 3
Fake inside code
\`\`\`
Real text
## Act 2
### Scene 3
Real Act 2 Scene 3`

  const headings = scanHeadings(md)
  assert.deepStrictEqual(
    headings.map(h => h.heading),
    ['Act 1', 'Scene 1', 'Act 2', 'Scene 3'],
  )

  const r = extractSectionPath(md, 'act-2/scene-3')
  assert.strictEqual(r.status, 'found')
  assert.strictEqual(r.text, 'Real Act 2 Scene 3')
})

test('extractSectionPath supports dotted heading names', () => {
  const md = `## Act 1
### 1.2 Overview
Section with numbers and dots`

  const r = extractSectionPath(md, 'act-1/1.2-overview')
  assert.strictEqual(r.status, 'found')
  assert.strictEqual(r.text, 'Section with numbers and dots')
})

test('socketKey preserves / and does not collide with flat dash', () => {
  assert.strictEqual(socketKey('act-2/scene-3'), 'act-2/scene-3')
  assert.strictEqual(socketKey('Act 2 / Scene 3'), 'act-2/scene-3')
  assert.strictEqual(socketKey('act-2-scene-3'), 'act-2-scene-3')
  assert.notStrictEqual(socketKey('act-2/scene-3'), socketKey('act-2-scene-3'))
  assert.strictEqual(outputKey('writer', 'act-2/scene-3'), 'writer::act-2/scene-3')
  assert.strictEqual(outputKey('writer', 'act-2-scene-3'), 'writer::act-2-scene-3')
  assert.strictEqual(isWholeOutput('act-2/scene-3'), false)
  assert.strictEqual(isWholeOutput('output'), true)

  const tok = parseToken('writer.act-2/scene-3')
  assert.deepStrictEqual(tok, { kind: 'ref', node: 'writer', socket: 'act-2/scene-3' })
  assert.deepStrictEqual(endpointOf(tok!), { node: 'writer', socket: 'act-2/scene-3' })
})

test('evalCondition resolves nested section sockets', () => {
  const ctx = new Map<string, AgentOutput>([
    ['writer', makeOutput('writer', '## Act 2\n### Scene 3\nClimax reached')],
  ])

  assert.strictEqual(evalCondition('{writer.act-2/scene-3} == "climax reached"', ctx), true)
  assert.strictEqual(evalCondition('{writer.act-2/scene-3} contains "climax"', ctx), true)
  assert.strictEqual(evalCondition('exists {writer.act-2/scene-3}', ctx), true)
  assert.strictEqual(evalCondition('exists {writer.act-2/scene-99}', ctx), false)
})

test('buildLayoutModel projects nested section sockets onto panels', () => {
  const model = buildLayoutModel(
    {
      slug: 'c', name: 'c', description: '', filePath: '', isFavorite: false,
      nodes: [], edges: [], view: 'timeline',
      outputs: [
        { name: 'scene', node: 'writer', socket: 'act-2/scene-3' },
        { name: 'missing', node: 'writer', socket: 'act-2/missing' },
      ],
    },
    [makeOutput('writer', '## Act 2\n### Scene 3\nLine 1\nLine 2')],
  )

  assert.strictEqual(model.panels[0].text, 'Line 1\nLine 2')
  assert.strictEqual(model.panels[0].lines, 2)
  assert.strictEqual(model.panels[0].state, 'filled')

  assert.strictEqual(model.panels[1].text, '')
  assert.strictEqual(model.panels[1].state, 'empty')
})

test('validateChain validates declared path sockets and prevents collisions', () => {
  const agent: AgentDef = {
    slug: 'writer', name: 'writer', model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }, { name: 'act-2/scene-3' }], inputs: [],
    systemPrompt: 'Write {input}', filePath: '',
  }
  const dst: AgentDef = {
    slug: 'reader', name: 'reader', model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }], inputs: [],
    systemPrompt: 'Read {in}', filePath: '',
  }

  const validChain: ChainDef = {
    slug: 'test', name: 'test', description: '', filePath: '',
    nodes: [
      { id: 'w', kind: 'agent', agent: 'writer' },
      { id: 'r', kind: 'agent', agent: 'reader' },
    ],
    edges: [{ fromNode: 'w', fromSocket: 'act-2/scene-3', toNode: 'r', toSocket: 'in' }],
  }

  const validResult = validateChain(validChain, [agent, dst])
  assert.strictEqual(validResult.valid, true)

  // Flat selector must not collide or falsely match the nested declaration
  const collidingChain: ChainDef = {
    ...validChain,
    edges: [{ fromNode: 'w', fromSocket: 'act-2-scene-3', toNode: 'r', toSocket: 'in' }],
  }
  const collideResult = validateChain(collidingChain, [agent, dst])
  assert.strictEqual(collideResult.valid, false)
  assert.ok(collideResult.errors.some(e => e.includes('no such output socket')))
})

test('readSocket and resolveNodePrompt handle nested section sockets and warnings', () => {
  const agentNode: ChainNode = { id: 'w', kind: 'agent', agent: 'writer' }
  const consumerNode: ChainNode = { id: 'r', kind: 'agent', agent: 'reader' }
  const readerAgent: AgentDef = {
    slug: 'reader', name: 'reader', model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }], inputs: [],
    systemPrompt: 'Read: {scene}', filePath: '',
  }
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [agentNode, consumerNode],
    edges: [{ fromNode: 'w', fromSocket: 'act-2/scene-3', toNode: 'r', toSocket: 'scene' }],
  }

  // 1. Success case
  const okOutputs = new Map<string, AgentOutput>([
    ['w', makeOutput('w', '## Act 2\n### Scene 3\nEpic showdown')],
  ])
  const okRead = readSocket(agentNode, 'act-2/scene-3', okOutputs, '', readCtx)
  assert.deepStrictEqual(okRead, { value: 'Epic showdown' })
  const okPrompt = resolveNodePrompt(consumerNode, chain, readerAgent, okOutputs, '', readCtx)
  assert.strictEqual(okPrompt.prompt, 'Read: Epic showdown')
  assert.deepStrictEqual(okPrompt.warnings, [])

  // 2. Missing section warning
  const missingOutputs = new Map<string, AgentOutput>([
    ['w', makeOutput('w', '## Act 1\n### Scene 1\nOther text')],
  ])
  const missingRead = readSocket(agentNode, 'act-2/scene-3', missingOutputs, '', readCtx)
  assert.deepStrictEqual(missingRead, { value: '', missingSection: 'act-2/scene-3' })
  const missingPrompt = resolveNodePrompt(consumerNode, chain, readerAgent, missingOutputs, '', readCtx)
  assert.strictEqual(missingPrompt.prompt, 'Read: ')
  assert.deepStrictEqual(missingPrompt.warnings, [
    { fromNode: 'w', section: 'act-2/scene-3', toNode: 'r', toSocket: 'scene' },
  ])

  // 3. Ambiguous section warning
  const ambigOutputs = new Map<string, AgentOutput>([
    ['w', makeOutput('w', '## Act 2\n### Scene 3\nFirst pick\n### Scene 3\nSecond pick')],
  ])
  const ambigRead = readSocket(agentNode, 'act-2/scene-3', ambigOutputs, '', readCtx)
  assert.deepStrictEqual(ambigRead, { value: 'First pick', ambiguousSection: 'act-2/scene-3' })
  const ambigPrompt = resolveNodePrompt(consumerNode, chain, readerAgent, ambigOutputs, '', readCtx)
  assert.strictEqual(ambigPrompt.prompt, 'Read: First pick')
  assert.deepStrictEqual(ambigPrompt.warnings, [
    { fromNode: 'w', section: 'act-2/scene-3', toNode: 'r', toSocket: 'scene', reason: 'ambiguous' },
  ])

  // 4. Empty leaf
  const emptyOutputs = new Map<string, AgentOutput>([
    ['w', makeOutput('w', '## Act 2\n### Scene 3\n\n## Act 3')],
  ])
  const emptyRead = readSocket(agentNode, 'act-2/scene-3', emptyOutputs, '', readCtx)
  assert.deepStrictEqual(emptyRead, { value: '', emptySection: 'act-2/scene-3' })
  const emptyPrompt = resolveNodePrompt(consumerNode, chain, readerAgent, emptyOutputs, '', readCtx)
  assert.strictEqual(emptyPrompt.prompt, 'Read: [scene: "act-2/scene-3" section empty]')
  assert.deepStrictEqual(emptyPrompt.warnings, [])
})

test('sectionWarningText formats missing and ambiguous warnings correctly', () => {
  const missingWarn: SectionWarning = {
    fromNode: 'writer', section: 'act-2/scene-3', toNode: 'reader', toSocket: 'scene',
  }
  assert.strictEqual(
    sectionWarningText(missingWarn),
    `writer's output has no "act-2/scene-3" section — {scene} on reader resolved to empty.`,
  )

  const ambigWarn: SectionWarning = {
    fromNode: 'writer', section: 'act-2/scene-3', toNode: 'reader', toSocket: 'scene', reason: 'ambiguous',
  }
  assert.strictEqual(
    sectionWarningText(ambigWarn),
    `writer's output has multiple "act-2/scene-3" sections — {scene} on reader resolved to first match.`,
  )

  assert.strictEqual(sameSectionWarning(missingWarn, { ...missingWarn, reason: 'missing' }), true)
  assert.strictEqual(sameSectionWarning(missingWarn, ambigWarn), false)
})

test('runChainGraph executes nested section edge and reports warnings', async () => {
  const chain: ChainDef = {
    slug: 'nested-chain', name: 'nested-chain', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'w', kind: 'agent', agent: 'world-builder' },
      { id: 'c', kind: 'agent', agent: 'character-designer' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w', toSocket: 'input' },
      { fromNode: 'w', fromSocket: 'act-2/scene-3', toNode: 'c', toSocket: 'world' },
    ],
  }

  const agents: AgentDef[] = [
    {
      slug: 'world-builder', name: 'world-builder', model: 'm', description: '',
      skills: [], context: [], input_from: 'user', output_format: 'markdown',
      outputs: [{ name: 'output' }, { name: 'act-2/scene-3' }], inputs: [],
      systemPrompt: 'Seed: {input}', filePath: '',
    },
    {
      slug: 'character-designer', name: 'character-designer', model: 'm', description: '',
      skills: [], context: [], input_from: 'user', output_format: 'markdown',
      outputs: [{ name: 'output' }], inputs: [],
      systemPrompt: 'World: {world}', filePath: '',
    },
  ]

  // Case 1: successful extraction
  const warnings1: SectionWarning[] = []
  const res1 = await runChainGraph(
    chain, { agents, root: '/tmp' },
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings1.push(w) },
    {
      seedPrompt: 'GO',
      run: async (agent, prompt) => {
        if (agent.slug === 'world-builder') {
          return {
            agentName: agent.name, systemPrompt: '', input: prompt,
            output: '## Act 2\n### Scene 3\nNested scene content',
            tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: agent.model,
            timestamp: '', status: 'success',
          }
        }
        return {
          agentName: agent.name, systemPrompt: '', input: prompt,
          output: `CHARS with ${prompt}`,
          tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: agent.model,
          timestamp: '', status: 'success',
        }
      },
    },
  )
  assert.deepStrictEqual(warnings1, [])
  const charOutput = res1.find(r => r.nodeId === 'c')!
  assert.ok(charOutput.input.includes('World: Nested scene content'))

  // Case 2: missing section warning
  const warnings2: SectionWarning[] = []
  await runChainGraph(
    chain, { agents, root: '/tmp' },
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings2.push(w) },
    {
      seedPrompt: 'GO',
      run: async (agent, prompt) => ({
        agentName: agent.name, systemPrompt: '', input: prompt,
        output: '## Act 1\nNo act 2 here',
        tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: agent.model,
        timestamp: '', status: 'success',
      }),
    },
  )
  assert.deepStrictEqual(warnings2, [
    { fromNode: 'w', section: 'act-2/scene-3', toNode: 'c', toSocket: 'world' },
  ])

  // Case 3: ambiguous duplicate section warning
  const warnings3: SectionWarning[] = []
  const res3 = await runChainGraph(
    chain, { agents, root: '/tmp' },
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings3.push(w) },
    {
      seedPrompt: 'GO',
      run: async (agent, prompt) => {
        if (agent.slug === 'world-builder') {
          return {
            agentName: agent.name, systemPrompt: '', input: prompt,
            output: '## Act 2\n### Scene 3\nFirst showdown\n### Scene 3\nSecond showdown',
            tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: agent.model,
            timestamp: '', status: 'success',
          }
        }
        return {
          agentName: agent.name, systemPrompt: '', input: prompt,
          output: `CHARS with ${prompt}`,
          tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: agent.model,
          timestamp: '', status: 'success',
        }
      },
    },
  )
  assert.deepStrictEqual(warnings3, [
    { fromNode: 'w', section: 'act-2/scene-3', toNode: 'c', toSocket: 'world', reason: 'ambiguous' },
  ])
  const charOutput3 = res3.find(r => r.nodeId === 'c')!
  assert.ok(charOutput3.input.includes('World: First showdown'))
})

test('socketHandles exposes path sockets with slashes on the canvas', () => {
  const agent: AgentDef = {
    slug: 'writer', name: 'writer', model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }, { name: 'act-2/scene-3' }],
    inputs: [{ name: 'topic' }],
    systemPrompt: 'Write {topic}', filePath: '',
  }
  const node: ChainNode = { id: 'w', kind: 'agent', agent: 'writer' }
  const workspace = { chain: { slug: '', name: '', description: '', filePath: '', nodes: [node], edges: [] }, agents: [agent], chains: [] }

  const handles = socketHandles(node, workspace)
  assert.deepStrictEqual(handles, [
    { id: 'topic', side: 'input' },
    { id: 'output', side: 'output' },
    { id: 'act-2/scene-3', side: 'output' },
  ])
})
