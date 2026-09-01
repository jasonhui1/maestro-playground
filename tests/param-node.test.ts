import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { readSocket, resolveNodePrompt } from '../lib/resolveNode'
import { parseChainContent } from '../lib/fs/parseChain'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, AgentOutput, ChainNode } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}

test('a chain-level parameter parses from frontmatter', () => {
  const raw = `---
name: wrong-audience
view: timeline
parameter:
  name: target audience
  options: [your mom, a compiler]
  node: audience
nodes:
  - { id: source, kind: seed }
  - { id: audience, kind: param }
---
`
  const c = parseChainContent(raw, 'wrong-audience')
  assert.deepStrictEqual(c.parameter, { name: 'target audience', options: ['your mom', 'a compiler'], node: 'audience' })
  assert.strictEqual(c.nodes[1].kind, 'param')
})

test('a chain with no declared parameter has none', () => {
  const c = parseChainContent(`---\nname: x\n---\n`, 'x')
  assert.strictEqual(c.parameter, undefined)
})

test('readSocket reads a param node from the run-supplied value, not the file', () => {
  const node: ChainNode = { id: 'audience', kind: 'param' }
  const read = readSocket(node, 'output', new Map(), 'SEED TEXT', () => '', 'a compiler')
  assert.strictEqual(read.value, 'a compiler')
})

test('resolveNodePrompt fills a slot wired to a param node with the chosen value', () => {
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'audience', kind: 'param' },
      { id: 'rewrite', kind: 'agent', agent: 'rewriter' },
    ],
    edges: [{ fromNode: 'audience', fromSocket: 'output', toNode: 'rewrite', toSocket: 'audience' }],
  }
  const rewrite = chain.nodes[1]
  const { prompt } = resolveNodePrompt(
    rewrite, chain, agent('rewriter', 'Rewrite for {audience}.'),
    new Map(), 'SEED', () => '', 'a compiler',
  )
  assert.strictEqual(prompt, 'Rewrite for a compiler.')
})

test('runChainGraph threads the chosen parameter value into the agent that reads it', async () => {
  const agents = [agent('rewriter', 'Rewrite for {audience}: {document}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'source', kind: 'seed' },
      { id: 'audience', kind: 'param' },
      { id: 'rewrite', kind: 'agent', agent: 'rewriter' },
    ],
    edges: [
      { fromNode: 'source', fromSocket: 'output', toNode: 'rewrite', toSocket: 'document' },
      { fromNode: 'audience', fromSocket: 'output', toNode: 'rewrite', toSocket: 'audience' },
    ],
  }
  let seenPrompt = ''
  const stub = (async (a: AgentDef, systemPrompt: string) => {
    seenPrompt = systemPrompt
    return { agentName: a.name, systemPrompt, input: '', output: 'OUT',
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
  }) as never
  const noop = { onStart() {}, onToken() {}, onDone() {} }
  await runChainGraph(chain, agents, [], 'MY DOC', '/ws', noop, stub, [], [], [], 0, 'a compiler')
  assert.strictEqual(seenPrompt, 'Rewrite for a compiler: MY DOC')
})

test('a chain declaring a parameter must name exactly one param node as its target', () => {
  const paramNode: ChainNode = { id: 'audience', kind: 'param' }
  const base: Omit<ChainDef, 'parameter' | 'nodes'> = { slug: 'c', name: 'c', description: '', filePath: '', edges: [] }

  // wired correctly
  const ok = validateChain(
    { ...base, nodes: [paramNode], parameter: { name: 'target audience', options: ['a'], node: 'audience' } },
    [],
  )
  assert.strictEqual(ok.valid, true)

  // declares a parameter but names a node that isn't kind: param
  const wrongKind = validateChain(
    { ...base, nodes: [{ id: 'audience', kind: 'seed' }], parameter: { name: 'target audience', options: ['a'], node: 'audience' } },
    [],
  )
  assert.strictEqual(wrongKind.valid, false)

  // two param nodes for one declared parameter — readSocket's kind-based dispatch
  // would feed the chosen value to both, so this must fail validation (#69)
  const twoParamNodes = validateChain(
    { ...base, nodes: [paramNode, { id: 'other', kind: 'param' }], parameter: { name: 'target audience', options: ['a'], node: 'audience' } },
    [],
  )
  assert.strictEqual(twoParamNodes.valid, false)

  // a param node with no declared parameter — the run would have nowhere to send a value
  const undeclared = validateChain({ ...base, nodes: [paramNode] }, [])
  assert.strictEqual(undeclared.valid, false)
})
