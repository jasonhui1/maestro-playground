import { test } from 'vitest'
import assert from 'node:assert'
import { readSocket, resolveNodePrompt } from '../lib/resolveNode'
import { sectionWarningText } from '../lib/sectionWarning'
import type { SectionWarning } from '../lib/sectionWarning'
import { runChainGraph } from '../lib/executor'
import { runAgent } from '../lib/runner'
import { applyRunEvent, emptyNodeState } from '../lib/runState'
import type { AgentDef, AgentOutput, ChainDef, ChainNode } from '../lib/types'

function out(nodeId: string, output: string): AgentOutput {
  return {
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }
}

const read = (f: string) => `CTX:${f}`

test('readSocket signals only a wired section that the output does not carry', () => {
  const outs = new Map<string, AgentOutput>([
    ['a', out('a', 'BODY\n## Summary\nSHORT')],
    ['g', out('g', 'PASSED')],
  ])
  const agent: ChainNode = { id: 'a', kind: 'agent', agent: 'a' }
  const gate: ChainNode = { id: 'g', kind: 'gate' }
  const seed: ChainNode = { id: 's', kind: 'seed' }

  assert.deepStrictEqual(readSocket(agent, 'summary', outs, 'SEED', read), { value: 'SHORT' })
  assert.deepStrictEqual(readSocket(agent, 'changes', outs, 'SEED', read), { value: '', missingSection: 'changes' })
  // the heading is there and the convention was honoured; an empty body is not a miss
  const empty = new Map<string, AgentOutput>([['a', out('a', '## Summary\n\n## Changes\nX')]])
  assert.deepStrictEqual(readSocket(agent, 'summary', empty, 'SEED', read), { value: '' })
  // the whole output is never a section, however empty it is
  assert.deepStrictEqual(readSocket(agent, 'output', outs, 'SEED', read), { value: 'BODY\n## Summary\nSHORT' })
  assert.deepStrictEqual(readSocket(gate, 'anything', outs, 'SEED', read), { value: 'PASSED' })
  assert.deepStrictEqual(readSocket(seed, 'output', outs, 'SEED', read), { value: 'SEED' })
})

test('resolveNodePrompt names producer, consuming slot and expected section', () => {
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'wb', kind: 'agent', agent: 'world-builder' },
      { id: 'cd', kind: 'agent', agent: 'character-designer' },
    ],
    edges: [{ fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' }],
  }
  const agent: AgentDef = {
    slug: 'character-designer', name: 'character-designer', model: 'm', description: '',
    skills: [], context: [], input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }], inputs: [], systemPrompt: 'World: {world}', filePath: '',
  }
  const outs = new Map<string, AgentOutput>([['wb', out('wb', 'THE EMPIRE, no headings')]])

  const r = resolveNodePrompt(chain.nodes[1], chain, agent, outs, 'SEED', read)
  assert.strictEqual(r.prompt, 'World: ')
  assert.deepStrictEqual(r.warnings, [
    { fromNode: 'wb', section: 'summary', toNode: 'cd', toSocket: 'world' },
  ])

  const ok = new Map<string, AgentOutput>([['wb', out('wb', '## Summary\nSALT FLATS')]])
  const r2 = resolveNodePrompt(chain.nodes[1], chain, agent, ok, 'SEED', read)
  assert.strictEqual(r2.prompt, 'World: SALT FLATS')
  assert.deepStrictEqual(r2.warnings, [])
})

test('sectionWarningText names all four parts, and invents no heading spelling', () => {
  const w: SectionWarning = { fromNode: 'wb', section: 'key-changes', toNode: 'cd', toSocket: 'world' }
  const text = sectionWarningText(w)
  for (const part of ['key-changes', 'wb', 'cd', 'world']) assert.ok(text.includes(part), `${text} lacks ${part}`)
})

// --- the executor seam ---------------------------------------------------

function chainOf(fromSocket: string): ChainDef {
  return {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'wb', kind: 'agent', agent: 'world-builder' },
      { id: 'cd', kind: 'agent', agent: 'character-designer' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
      { fromNode: 'wb', fromSocket, toNode: 'cd', toSocket: 'world' },
    ],
  }
}

function agentsFor(): AgentDef[] {
  const base = {
    model: 'm', description: '', skills: [], context: [], input_from: 'user' as const,
    output_format: 'markdown' as const, outputs: [{ name: 'output' }], inputs: [], filePath: '',
  }
  return [
    { ...base, slug: 'world-builder', name: 'world-builder', systemPrompt: 'Seed: {input}' },
    { ...base, slug: 'character-designer', name: 'character-designer', systemPrompt: 'World: {world}' },
  ]
}

function runFnOf(bodyByAgent: Record<string, string>) {
  return (async (agent: AgentDef): Promise<AgentOutput> => ({
    agentName: agent.name, systemPrompt: '', input: '', output: bodyByAgent[agent.slug] ?? '',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: agent.model,
    timestamp: new Date().toISOString(), status: 'success',
  })) as unknown as typeof runAgent
}

async function runWith(chain: ChainDef, wbOutput: string) {
  const warnings: SectionWarning[] = []
  const results = await runChainGraph(
    chain, agentsFor(), [], 'SEED', '/tmp',
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings.push(w) },
    runFnOf({ 'world-builder': wbOutput, 'character-designer': 'CHARS' }),
  )
  return { warnings, results }
}

test('a missing wired section warns once and rides on the producing output', async () => {
  const { warnings, results } = await runWith(chainOf('summary'), 'THE EMPIRE, no headings')
  assert.deepStrictEqual(warnings, [
    { fromNode: 'wb', section: 'summary', toNode: 'cd', toSocket: 'world' },
  ])
  const wb = results.find(r => r.nodeId === 'wb')!
  assert.deepStrictEqual(wb.warnings, warnings)
  // the run is unaffected: node succeeds, the empty value still flows
  assert.strictEqual(wb.status, 'success')
  assert.strictEqual(results.find(r => r.nodeId === 'cd')!.status, 'success')
})

test('a present section, and a chain with no section slices, stay silent', async () => {
  const present = await runWith(chainOf('summary'), 'BODY\n## Summary\nSALT FLATS')
  assert.deepStrictEqual(present.warnings, [])
  assert.strictEqual(present.results.find(r => r.nodeId === 'wb')!.warnings, undefined)

  const whole = await runWith(chainOf('output'), 'THE EMPIRE, no headings')
  assert.deepStrictEqual(whole.warnings, [])
  assert.strictEqual(whole.results.find(r => r.nodeId === 'wb')!.warnings, undefined)
})

test('control-node inputs warn too, and a repeat violation warns once', async () => {
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'wb', kind: 'agent', agent: 'world-builder' },
      { id: 'cd', kind: 'agent', agent: 'character-designer' },
      { id: 'rep', kind: 'report' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
      { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
      { fromNode: 'wb', fromSocket: 'summary', toNode: 'rep', toSocket: 'in' },
    ],
  }
  const { warnings } = await runWith(chain, 'THE EMPIRE, no headings')
  assert.deepStrictEqual(warnings, [
    { fromNode: 'wb', section: 'summary', toNode: 'cd', toSocket: 'world' },
    { fromNode: 'wb', section: 'summary', toNode: 'rep', toSocket: 'in' },
  ])
})

test('a loop round is a new output, so it warns again', async () => {
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'ls', kind: 'loop-start', zone: 'r', state: ['draft'] },
      { id: 'wb', kind: 'agent', agent: 'world-builder', zone: 'r' },
      { id: 'cd', kind: 'agent', agent: 'character-designer', zone: 'r' },
      { id: 'le', kind: 'loop-end', zone: 'r', until: 'NEVER', maxIterations: 3 },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'ls', toSocket: 'draft' },
      { fromNode: 'ls', fromSocket: 'draft', toNode: 'wb', toSocket: 'input' },
      { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
      { fromNode: 'cd', fromSocket: 'output', toNode: 'le', toSocket: 'draft' },
    ],
  }
  const { warnings, results } = await runWith(chain, 'THE EMPIRE, no headings')
  assert.strictEqual(warnings.length, 3, 'one per round, not one per run')
  for (const wb of results.filter(r => r.nodeId === 'wb')) assert.strictEqual(wb.warnings?.length, 1)
})

// --- the run panel's state ------------------------------------------------

test('section_missing lands on the producing node and does not stack', () => {
  const w: SectionWarning = { fromNode: 'wb', section: 'summary', toNode: 'cd', toSocket: 'world' }
  let state = applyRunEvent({}, { type: 'section_missing', nodeId: 'wb', warning: w })
  state = applyRunEvent(state, { type: 'section_missing', nodeId: 'wb', warning: w })
  assert.deepStrictEqual(state.wb.warnings, [w])
  assert.deepStrictEqual(emptyNodeState().warnings, [])

  // a rerun of the producer clears what the previous round reported
  const rerun = applyRunEvent(state, { type: 'agent_start', nodeId: 'wb', agentName: 'wb', step: 0 })
  assert.deepStrictEqual(rerun.wb.warnings, [])
})
