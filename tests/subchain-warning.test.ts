import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { runAgent } from '../lib/runner'
import { sameSectionWarning, sectionWarningText } from '../lib/sectionWarning'
import type { SectionWarning } from '../lib/sectionWarning'
import type { AgentDef, AgentOutput, ChainDef } from '../lib/types'

const agent = (slug: string, systemPrompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt, filePath: '',
})

const runFnOf = (bodyByAgent: Record<string, string>): typeof runAgent => async (a): Promise<AgentOutput> => ({
  agentName: a.name, systemPrompt: '', input: '', output: bodyByAgent[a.slug] ?? '',
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: a.model,
  timestamp: new Date().toISOString(), status: 'success',
})

// research: inner-seed -> digger; the chain publishes digger's "Summary" section.
const research = (outputSocket = 'Summary'): ChainDef => ({
  slug: 'research', name: 'Research', description: '', filePath: '',
  nodes: [{ id: 'inner-seed', kind: 'seed' }, { id: 'digger', kind: 'agent', agent: 'digger' }],
  edges: [{ fromNode: 'inner-seed', fromSocket: 'output', toNode: 'digger', toSocket: 'topic' }],
  inputs: [{ name: 'topic', node: 'inner-seed' }],
  outputs: [{ name: 'summary', node: 'digger', socket: outputSocket }],
})

// story: seed -> sub-1(research) -> writer, reading the subchain's "summary" port.
const story: ChainDef = {
  slug: 'story', name: 'Story', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'sub-1', kind: 'subchain', subchain: 'research' },
    { id: 'writer', kind: 'agent', agent: 'writer' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'sub-1', toSocket: 'topic' },
    { fromNode: 'sub-1', fromSocket: 'summary', toNode: 'writer', toSocket: 'world' },
  ],
}

const cast = [agent('digger', 'Topic: {topic}'), agent('writer', 'World: {world}')]

async function runStory(diggerOutput: string, inner: ChainDef = research()) {
  const warnings: SectionWarning[] = []
  const results = await runChainGraph(
    story, cast, [], 'SEED', '/tmp',
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings.push(w) },
    runFnOf({ digger: diggerOutput, writer: 'PROSE' }), [], [inner],
  )
  return { warnings, results }
}

test('a subchain output port whose section is absent warns on the subchain node', async () => {
  const { warnings, results } = await runStory('FINDINGS\n## Findings\nX')

  const expected: SectionWarning = {
    fromNode: 'sub-1', viaNode: 'digger', section: 'Summary', toNode: 'sub-1', toSocket: 'summary',
  }
  assert.deepStrictEqual(warnings, [expected])

  // the trap: sub-1's record does not exist while the port is being read, so a
  // warning that is only streamed would vanish from the log and from replay
  const sub = results.find(r => r.nodeId === 'sub-1')!
  assert.deepStrictEqual(sub.warnings, [expected])

  // the run is unaffected — the empty value still flows downstream
  assert.strictEqual(sub.status, 'success')
  assert.strictEqual(results.find(r => r.nodeId === 'writer')!.status, 'success')
})

test('a port reading a present-but-empty heading stays silent, as an edge does', async () => {
  const { warnings, results } = await runStory('## Summary\n\n## Findings\nX')
  assert.deepStrictEqual(warnings, [])
  assert.strictEqual(results.find(r => r.nodeId === 'sub-1')!.warnings, undefined)
  assert.strictEqual(results.find(r => r.nodeId === 'sub-1::summary')!.output, '')

  // a port reading the whole output never asks for a section at all
  const whole = await runStory('NO HEADINGS', {
    ...research(), outputs: [{ name: 'summary', node: 'digger' }],
  })
  assert.deepStrictEqual(whole.warnings, [])
  assert.strictEqual(whole.results.find(r => r.nodeId === 'sub-1::summary')!.output, 'NO HEADINGS')
})

// research-deep: the violation is between two *inner* nodes, so both endpoints of
// the warning are invisible from outside the subchain.
const researchDeep: ChainDef = {
  slug: 'research', name: 'Research', description: '', filePath: '',
  nodes: [
    { id: 'inner-seed', kind: 'seed' },
    { id: 'digger', kind: 'agent', agent: 'digger' },
    { id: 'polisher', kind: 'agent', agent: 'polisher' },
  ],
  edges: [
    { fromNode: 'inner-seed', fromSocket: 'output', toNode: 'digger', toSocket: 'topic' },
    { fromNode: 'digger', fromSocket: 'summary', toNode: 'polisher', toSocket: 'draft' },
  ],
  inputs: [{ name: 'topic', node: 'inner-seed' }],
  outputs: [{ name: 'summary', node: 'polisher' }],
}

test('a violation inside the subchain surfaces on the subchain node, naming its producer', async () => {
  const warnings: SectionWarning[] = []
  const results = await runChainGraph(
    story, [...cast, agent('polisher', 'Draft: {draft}')], [], 'SEED', '/tmp',
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings.push(w) },
    runFnOf({ digger: 'NO HEADINGS', polisher: 'POLISHED', writer: 'PROSE' }), [], [researchDeep],
  )

  const expected: SectionWarning = {
    fromNode: 'sub-1', viaNode: 'digger', section: 'summary', toNode: 'polisher', toSocket: 'draft',
  }
  assert.deepStrictEqual(warnings, [expected], 'the inner warning is re-anchored, not discarded')
  assert.deepStrictEqual(results.find(r => r.nodeId === 'sub-1')!.warnings, [expected])
})

test('a violation two subchains deep re-anchors at each boundary', async () => {
  // story -> sub-1(research) -> sub-2(deep) -> miner, which omits "## Nugget"
  const deep: ChainDef = {
    slug: 'deep', name: 'Deep', description: '', filePath: '',
    nodes: [{ id: 'deep-seed', kind: 'seed' }, { id: 'miner', kind: 'agent', agent: 'miner' }],
    edges: [{ fromNode: 'deep-seed', fromSocket: 'output', toNode: 'miner', toSocket: 'topic' }],
    inputs: [{ name: 'topic', node: 'deep-seed' }],
    outputs: [{ name: 'nugget', node: 'miner', socket: 'Nugget' }],
  }
  const nested: ChainDef = {
    slug: 'research', name: 'Research', description: '', filePath: '',
    nodes: [{ id: 'inner-seed', kind: 'seed' }, { id: 'sub-2', kind: 'subchain', subchain: 'deep' }],
    edges: [{ fromNode: 'inner-seed', fromSocket: 'output', toNode: 'sub-2', toSocket: 'topic' }],
    inputs: [{ name: 'topic', node: 'inner-seed' }],
    outputs: [{ name: 'summary', node: 'sub-2', socket: 'nugget' }],
  }

  const warnings: SectionWarning[] = []
  const results = await runChainGraph(
    story, [...cast, agent('miner', 'Topic: {topic}')], [], 'SEED', '/tmp',
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings.push(w) },
    runFnOf({ miner: 'NO HEADINGS', writer: 'PROSE' }), [], [nested, deep],
  )

  // sub-1 is the only outer-visible node, so the warning lands there — but it still
  // names miner as the producer and sub-2's port as the consumer
  assert.deepStrictEqual(warnings, [
    { fromNode: 'sub-1', viaNode: 'miner', section: 'Nugget', toNode: 'sub-2', toSocket: 'nugget' },
  ])
  assert.strictEqual(results.find(r => r.nodeId === 'sub-1')!.warnings!.length, 1)
  assert.strictEqual(results.find(r => r.nodeId === 'sub-2'), undefined, 'inner nodes stay out of the outer run')
})

test('two ports failing on one inner output stay distinct, and repeat readers do not stack', async () => {
  const twoPorts: ChainDef = {
    ...research(),
    outputs: [
      { name: 'summary', node: 'digger', socket: 'Summary' },
      { name: 'findings', node: 'digger', socket: 'Findings' },
    ],
  }
  // two downstream readers of the same failed port: the dedup rule is per producing
  // output, so the second reader adds nothing
  const twoReaders: ChainDef = {
    ...story,
    nodes: [...story.nodes, { id: 'rep', kind: 'report' }],
    edges: [...story.edges, { fromNode: 'sub-1', fromSocket: 'summary', toNode: 'rep', toSocket: 'in' }],
  }

  const warnings: SectionWarning[] = []
  await runChainGraph(
    twoReaders, cast, [], 'SEED', '/tmp',
    { onStart() {}, onToken() {}, onDone() {}, onWarning: w => warnings.push(w) },
    runFnOf({ digger: 'NO HEADINGS', writer: 'PROSE' }), [], [twoPorts],
  )

  assert.deepStrictEqual(warnings, [
    { fromNode: 'sub-1', viaNode: 'digger', section: 'Summary', toNode: 'sub-1', toSocket: 'summary' },
    { fromNode: 'sub-1', viaNode: 'digger', section: 'Findings', toNode: 'sub-1', toSocket: 'findings' },
  ], 'one warning per failed port, and no extra per downstream reader')
})

test('a port bound to an inner node that never answered stays silent', async () => {
  // digger's {topic} slot is unwired, so digger is skipped — there is no answer to
  // hold the convention against, and a section warning is only knowable from one
  const unreached: ChainDef = { ...research(), edges: [] }
  const { warnings, results } = await runStory('NEVER RUNS', unreached)

  assert.deepStrictEqual(warnings, [], 'a skipped producer is not a convention violation')
  assert.strictEqual(results.find(r => r.nodeId === 'sub-1')!.warnings, undefined)
  assert.strictEqual(results.find(r => r.nodeId === 'sub-1::summary')!.output, '')
})

// --- the warning's own vocabulary ------------------------------------------

test('viaNode names the invisible producer in the text; the plain form is untouched', () => {
  const port: SectionWarning = {
    fromNode: 'sub-1', viaNode: 'digger', section: 'Summary', toNode: 'sub-1', toSocket: 'summary',
  }
  // at a port boundary the subchain is both endpoints, so naming it twice reads oddly
  assert.strictEqual(
    sectionWarningText(port),
    'sub-1\'s "digger" has no "Summary" section — output socket {summary} resolved to empty.',
  )

  // an inner-to-inner violation has two real endpoints and keeps the {slot} on form
  const innerToInner: SectionWarning = {
    fromNode: 'sub-1', viaNode: 'digger', section: 'summary', toNode: 'polisher', toSocket: 'draft',
  }
  assert.strictEqual(
    sectionWarningText(innerToInner),
    'sub-1\'s "digger" has no "summary" section — {draft} on polisher resolved to empty.',
  )

  const edge: SectionWarning = { fromNode: 'wb', section: 'summary', toNode: 'cd', toSocket: 'world' }
  assert.strictEqual(
    sectionWarningText(edge),
    'wb\'s output has no "summary" section — {world} on cd resolved to empty.',
    'the edge form is byte-identical to #37',
  )
})

test('warnings differing only in viaNode are distinct', () => {
  const base = { fromNode: 'sub-1', section: 'Summary', toNode: 'sub-1', toSocket: 'summary' }
  assert.ok(!sameSectionWarning({ ...base, viaNode: 'digger' }, { ...base, viaNode: 'polisher' }))
  assert.ok(sameSectionWarning({ ...base, viaNode: 'digger' }, { ...base, viaNode: 'digger' }))
  assert.ok(sameSectionWarning(base, base))
})
