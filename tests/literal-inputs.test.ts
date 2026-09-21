import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { parseChainContent } from '../lib/parseChain'
import { chainToData } from '../lib/serializeChain'
import { validateChain } from '../lib/chainGraph'
import { resolveNodePrompt } from '../lib/resolveNode'
import type { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return {
    slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
    inputs: [], systemPrompt: prompt, filePath: '',
  }
}

const noop = { onStart() {}, onToken() {}, onDone() {} }

const stub = (async (a: AgentDef, sp: string) => ({
  agentName: a.name, systemPrompt: sp, input: '', output: `OUT(${a.slug})`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})) as never

test('Rule 1: Connected wire precedence — connected upstream failure prevents node from running even if literal exists', async () => {
  const agents = [agent('p', 'Make: {input}'), agent('c', 'Do: {in}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'p', kind: 'agent', agent: 'p' },
      { id: 'g', kind: 'gate', condition: '{p.output} contains "IMPOSSIBLE"' }, // blocks
      {
        id: 'c', kind: 'agent', agent: 'c',
        inputs: { in: 'saved literal text' }, // has literal, but wired to blocked gate
      },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
      { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
      { fromNode: 'g', fromSocket: 'output', toNode: 'c', toSocket: 'in' },
    ],
  }

  const res = await runChainGraph(chain, { agents, root: '/ws' }, noop, { seedPrompt: 'SEED', run: stub })
  const c = res.find(o => o.nodeId === 'c')!
  assert.strictEqual(c.status, 'skipped', 'c must be skipped because connected upstream edge is not live; must not fall back to literal')
})

test('Rule 1: Connected wire precedence — section warning reported from wire, literal is not used', () => {
  const a = agent('worker', 'Context: {ctx}')
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'p', kind: 'agent', agent: 'producer' },
      { id: 'w', kind: 'agent', agent: 'worker', inputs: { ctx: 'literal fallback' } },
    ],
    edges: [
      { fromNode: 'p', fromSocket: 'missing_heading', toNode: 'w', toSocket: 'ctx' },
    ],
  }
  const outputs = new Map<string, AgentOutput>([
    ['p', {
      nodeId: 'p', agentName: 'producer', systemPrompt: '', input: '', output: '## Other\ntext',
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
    }],
  ])

  const resolved = resolveNodePrompt(chain.nodes[1], chain, a, outputs, '', () => '')
  assert.ok(resolved.warnings.length > 0, 'warns about missing section from wire')
  assert.strictEqual(resolved.prompt, 'Context: ', 'evaluates wire (empty), does not fall back to literal')
})

test('Rule 2: Disconnected slot uses saved typed literal', async () => {
  const agents = [agent('w', 'Instruction: {instructions}\nSeed: {seed}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      {
        id: 'w', kind: 'agent', agent: 'w',
        inputs: { instructions: 'Write three funny ideas' },
      },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w', toSocket: 'seed' },
    ],
  }

  const res = await runChainGraph(chain, { agents, root: '/ws' }, noop, { seedPrompt: 'my seed', run: stub })
  const w = res.find(o => o.nodeId === 'w')!
  assert.strictEqual(w.status, 'success')
  assert.ok(w.systemPrompt.includes('Instruction: Write three funny ideas'))
  assert.ok(w.systemPrompt.includes('Seed: my seed'))
})

test('Rule 3: Empty string "" is an explicitly valid literal', async () => {
  const agents = [agent('w', 'Instruction: <{instructions}>\nSeed: {seed}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      {
        id: 'w', kind: 'agent', agent: 'w',
        inputs: { instructions: '' }, // explicitly empty string
      },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w', toSocket: 'seed' },
    ],
  }

  const res = await runChainGraph(chain, { agents, root: '/ws' }, noop, { seedPrompt: 'my seed', run: stub })
  const w = res.find(o => o.nodeId === 'w')!
  assert.strictEqual(w.status, 'success')
  assert.ok(w.systemPrompt.includes('Instruction: <>'), 'empty string was resolved into slot')
  assert.ok(!w.systemPrompt.includes('[instructions: not wired]'))
})

test('Rule 3: Unset slot without literal blocks node readiness', async () => {
  const agents = [agent('w', 'Instruction: {instructions}\nSeed: {seed}')]
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'w', kind: 'agent', agent: 'w' }, // instructions is unwired and unset
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'w', toSocket: 'seed' },
    ],
  }

  const res = await runChainGraph(chain, { agents, root: '/ws' }, noop, { seedPrompt: 'my seed', run: stub })
  const w = res.find(o => o.nodeId === 'w')!
  assert.strictEqual(w.status, 'skipped', 'w must be skipped because instructions is unwired and unset')
})

test('Rule 4: Parsing and serialization roundtrip preserves node.inputs', () => {
  const yaml = `---
name: test-chain
nodes:
  - id: worker
    kind: decider
    agent: my-agent
    inputs:
      instructions: "some instructions"
      blank: ""
edges: []
---
`
  const parsed = parseChainContent(yaml, 'test-chain')
  const worker = parsed.nodes.find(n => n.id === 'worker')!
  assert.deepStrictEqual(worker.inputs, { instructions: 'some instructions', blank: '' })

  const serialized = chainToData(parsed)
  const serNodes = serialized.nodes as Record<string, unknown>[]
  assert.deepStrictEqual(serNodes[0].inputs, { instructions: 'some instructions', blank: '' })
})

test('Validation: acceptsInputs and valid slot names', () => {
  const myAgent = agent('my-agent', 'Do: {topic}')
  const agents = [myAgent]

  // Valid inputs
  const validChain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'w', kind: 'agent', agent: 'my-agent', inputs: { topic: 'math' } },
    ],
    edges: [],
  }
  const v1 = validateChain(validChain, agents)
  assert.strictEqual(v1.valid, true)

  // Unsupported kind has inputs
  const invalidKindChain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 's', kind: 'seed', inputs: { topic: 'math' } },
    ],
    edges: [],
  }
  const v2 = validateChain(invalidKindChain, agents)
  assert.strictEqual(v2.valid, false)
  assert.ok(v2.errors.some(e => e.includes('does not accept literal inputs')))

  // Unknown slot name
  const unknownSlotChain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'w', kind: 'agent', agent: 'my-agent', inputs: { unknown_slot: 'math' } },
    ],
    edges: [],
  }
  const v3 = validateChain(unknownSlotChain, agents)
  assert.strictEqual(v3.valid, false)
  assert.ok(v3.errors.some(e => e.includes('literal declared for unknown input slot "unknown_slot"')))

  // Control kind (gate) rejects literal inputs
  const gateChain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'g', kind: 'gate', condition: 'true', inputs: { in: 'blocked' } },
    ],
    edges: [],
  }
  const v4 = validateChain(gateChain, agents)
  assert.strictEqual(v4.valid, false)
  assert.ok(v4.errors.some(e => e.includes('Node "g" of kind "gate" does not accept literal inputs')))

  // Malformed non-object inputs reject
  const malformedChain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'w', kind: 'agent', agent: 'my-agent', inputs: 'not-an-object' as unknown as Record<string, string> },
    ],
    edges: [],
  }
  const v5 = validateChain(malformedChain, agents)
  assert.strictEqual(v5.valid, false)
  assert.ok(v5.errors.some(e => e.includes('inputs must be a key-value mapping')))

  // Non-string input value rejects
  const nonStringChain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'w', kind: 'agent', agent: 'my-agent', inputs: { topic: 123 as unknown as string } },
    ],
    edges: [],
  }
  const v6 = validateChain(nonStringChain, agents)
  assert.strictEqual(v6.valid, false)
  assert.ok(v6.errors.some(e => e.includes('literal for slot "topic" must be a string')))
})

