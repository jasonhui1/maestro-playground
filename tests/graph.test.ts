import assert from 'node:assert'
import { buildRunGraph } from '../lib/graph'
import { AgentDef, RunMeta, AgentOutput, OutputSocketDef } from '../lib/types'

function mkAgent(name: string, systemPrompt: string, outputs: OutputSocketDef[] = [{ name: 'output' }]): AgentDef {
  return {
    slug: name, name, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs, inputs: [],
    systemPrompt, filePath: `${name}.md`,
  }
}
function mkOut(agentName: string, output: string): AgentOutput {
  return {
    agentName, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
    model: 'm', timestamp: '', status: 'success',
  }
}
function mkRun(agentOutputs: AgentOutput[]): RunMeta {
  return { runId: 'r', chainName: 'c', seedPrompt: 'seed', startedAt: '', status: 'complete', agentOutputs }
}

// --- Scenario 1: linear chain, seed shown only because step 0 uses {input} ---
{
  const agents = [
    mkAgent('world-builder', 'Build from {input}'),
    mkAgent('character-designer', 'Use {input}'),
  ]
  const run = mkRun([mkOut('world-builder', '## Summary\nx'), mkOut('character-designer', 'done')])
  const g = buildRunGraph(run, agents)

  assert.ok(g.nodes.find(n => n.id === 'seed'), 'seed node present')
  assert.ok(g.nodes.find(n => n.id === 'agent-0'), 'agent-0 present')
  // wire seed -> agent-0 (input), wire agent-0 -> agent-1 (input)
  assert.ok(g.edges.find(e => e.source === 'seed' && e.target === 'agent-0'), 'seed feeds first agent')
  assert.ok(g.edges.find(e => e.source === 'agent-0' && e.target === 'agent-1'), 'first feeds second')
}

// --- Scenario 2: fan-in (multi-input) + context file node ---
{
  const agents = [
    mkAgent('world-builder', 'no inputs here', [{ name: 'output' }, { name: 'summary' }]),
    mkAgent('character-designer', 'Use {input} and {world-builder.summary} and {lore}'),
  ]
  const run = mkRun([mkOut('world-builder', '## Summary\ns'), mkOut('character-designer', 'd')])
  const g = buildRunGraph(run, agents)

  const cd = g.nodes.find(n => n.id === 'agent-1')!
  assert.strictEqual(cd.inputs!.length, 3, 'character-designer has 3 input sockets')
  assert.ok(g.nodes.find(n => n.id === 'context-lore' && n.kind === 'context'), 'context node created')
  assert.ok(g.edges.find(e => e.source === 'context-lore' && e.target === 'agent-1'), 'lore feeds character-designer')
  // summary edge is NOT flagged because producer declares summary AND output contains ## Summary
  const sumEdge = g.edges.find(e => e.label === 'world-builder.summary')!
  assert.strictEqual(sumEdge.flagged, undefined, 'declared+present summary not flagged')
}

// --- Scenario 3: reference to an agent that did not run => stale node + flagged edge ---
{
  const agents = [mkAgent('character-designer', 'Use {ghost.summary}')]
  const run = mkRun([mkOut('character-designer', 'd')])
  const g = buildRunGraph(run, agents)

  const stale = g.nodes.find(n => n.stale)
  assert.ok(stale, 'stale node created for ghost')
  assert.strictEqual(stale!.agentName, 'ghost')
  const edge = g.edges.find(e => e.target === 'agent-0')!
  assert.strictEqual(edge.flagged, true, 'edge to stale node is flagged')
}

// --- Scenario 4: undeclared output + unresolved field ---
{
  const agents = [
    mkAgent('world-builder', 'nothing', [{ name: 'output' }]), // does NOT declare characters
    mkAgent('character-designer', 'Use {world-builder.characters}'),
  ]
  const run = mkRun([mkOut('world-builder', 'no sections'), mkOut('character-designer', 'd')])
  const g = buildRunGraph(run, agents)

  const edge = g.edges.find(e => e.label === 'world-builder.characters')!
  assert.strictEqual(edge.flagged, true, 'undeclared output ref is flagged')
  const cd = g.nodes.find(n => n.id === 'agent-1')!
  assert.strictEqual(cd.inputs![0].unresolvedField, true, 'characters is not resolver-supported')
}

console.log('✅ buildRunGraph tests passed')
