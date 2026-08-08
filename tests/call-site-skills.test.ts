import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { runChainGraph } from '../lib/executor'
import { resolveNodeSkills } from '../lib/nodeKinds'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, AgentOutput, SkillDef } from '../lib/types'

function skill(name: string, content: string): SkillDef {
  return { slug: name, name, type: 'craft', description: '', content, filePath: '' }
}

function agent(slug: string, skills: string[], prompt = 'Body {input}'): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills, context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}

// --- resolveNodeSkills: the merge rules directly ---

test('skills! overrides the resolved agent list for that node only', () => {
  const node = { id: 'n', kind: 'agent' as const, agent: 'a', 'skills!': ['red-teaming'] }
  assert.deepStrictEqual(resolveNodeSkills(node, ['core-protocol']), ['red-teaming'])
})

test('skills+ extends the resolved agent list for that node only', () => {
  const node = { id: 'n', kind: 'agent' as const, agent: 'a', 'skills+': ['red-teaming'] }
  assert.deepStrictEqual(resolveNodeSkills(node, ['core-protocol']), ['core-protocol', 'red-teaming'])
})

test('neither marker leaves the resolved agent list unchanged', () => {
  const node = { id: 'n', kind: 'agent' as const, agent: 'a' }
  assert.deepStrictEqual(resolveNodeSkills(node, ['core-protocol']), ['core-protocol'])
})

test('non agent/decider kinds are untouched by the markers', () => {
  const node = { id: 'n', kind: 'gate' as const, condition: 'true' }
  assert.deepStrictEqual(resolveNodeSkills(node, ['core-protocol']), ['core-protocol'])
})

// --- executor: two call sites of one agent produce two different system prompts ---

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'skep', kind: 'agent', agent: 'panel-member', 'skills!': ['red-teaming'] },
    { id: 'opt', kind: 'agent', agent: 'panel-member', 'skills+': ['red-teaming'] },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'skep', toSocket: 'input' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'opt', toSocket: 'input' },
  ],
}
const agents = [agent('panel-member', ['core-protocol'])]
const skills = [skill('core-protocol', 'CORE PROTOCOL TEXT'), skill('red-teaming', 'RED TEAMING TEXT')]

const seenPrompts: Record<string, string> = {}
const stub = (async (a: AgentDef, systemPrompt: string) => {
  seenPrompts[a.slug + ':' + systemPrompt.length] = systemPrompt
  return { agentName: a.name, systemPrompt, input: '', output: '',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never
const noop = { onStart() {}, onToken() {}, onDone() {} }

test('two nodes naming the same agent with different markers produce two different system prompts', async () => {
  const results = await runChainGraph(chain, agents, skills, 'SEED', '/ws', noop, stub)
  const skep = results.find(r => r.nodeId === 'skep')!
  const opt = results.find(r => r.nodeId === 'opt')!
  assert.notStrictEqual(skep.systemPrompt, opt.systemPrompt)
  // skills! dropped core-protocol entirely
  assert.ok(!skep.systemPrompt.includes('CORE PROTOCOL TEXT'), 'override drops the agent file list')
  assert.ok(skep.systemPrompt.includes('RED TEAMING TEXT'))
  // skills+ kept core-protocol and added red-teaming
  assert.ok(opt.systemPrompt.includes('CORE PROTOCOL TEXT'), 'extend keeps the agent file list')
  assert.ok(opt.systemPrompt.includes('RED TEAMING TEXT'))
  // the prompt body itself never changes — only the injected skills differ
  assert.ok(skep.systemPrompt.includes('Body SEED'))
  assert.ok(opt.systemPrompt.includes('Body SEED'))
})

// --- validation ---

test('a named skill that does not exist fails validation before the run starts', () => {
  const bad: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [{ id: 't', kind: 'agent', agent: 'panel-member', 'skills!': ['made-up-skill'] }],
    edges: [],
  }
  const result = validateChain(bad, agents, [], [], skills)
  assert.strictEqual(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('made-up-skill')), result.errors.join('\n'))
})

test('a chain with only known skill names in its markers validates clean', () => {
  const ok: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [{ id: 't', kind: 'agent', agent: 'panel-member', 'skills+': ['red-teaming'] }],
    edges: [],
  }
  const result = validateChain(ok, agents, [], [], skills)
  assert.strictEqual(result.valid, true, result.errors.join('\n'))
})

// --- round trip through the chain file format ---

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-call-site-skills-'))
  return wp
}

test('skills! and skills+ round-trip through parse and serialize', async () => {
  const { parseChainContent } = await import('../lib/parseChain')
  const { serializeChain } = await import('../lib/serializeChain')
  const wp = newWorkspace()
  const raw = `---
name: Panel
nodes:
  - id: skep
    kind: agent
    agent: panel-member
    skills!:
      - red-teaming
  - id: opt
    kind: agent
    agent: panel-member
    skills+:
      - red-teaming
edges: []
---
`
  const parsed = parseChainContent(raw, 'panel')
  assert.deepStrictEqual(parsed.nodes[0]['skills!' as never], ['red-teaming'])
  assert.deepStrictEqual(parsed.nodes[1]['skills+' as never], ['red-teaming'])

  const roundTripped = serializeChain({ name: parsed.name, description: parsed.description }, parsed.nodes, parsed.edges)
  const reparsed = parseChainContent(roundTripped, 'panel')
  assert.deepStrictEqual(reparsed.nodes[0]['skills!' as never], ['red-teaming'])
  assert.deepStrictEqual(reparsed.nodes[1]['skills+' as never], ['red-teaming'])
  fs.rmSync(wp, { recursive: true, force: true })
})
