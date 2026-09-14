import { test } from 'vitest'
import assert from 'node:assert'
import { loadWorkspace } from '../lib/fs/workspace'
import { validateChain } from '../lib/chainGraph'
import { runChainGraph } from '../lib/executor'
import { buildLayoutModel } from '../lib/layoutModel'
import { extractSections } from '../lib/graph'
import type { AgentDef, AgentOutput } from '../lib/types'

// #78: the hold note reads these panels and offers CANON? ticks from each proposer.
const PROPOSERS = ['character-director', 'gameplay-director', 'world-director', 'art-director', 'devils-advocate']
const VERDICT_SECTIONS = ['Creative Thesis', 'Player Fantasy', 'Pillars', 'Kill List', 'Greenlight Concept']

function workspace() {
  const ws = loadWorkspace()
  const chain = ws.chains.find(c => c.slug === 'creative-director')
  assert.ok(chain, 'creative-director chain exists')
  return { ...ws, chain }
}

const agentOf = (agents: AgentDef[], slug: string) => {
  const a = agents.find(x => x.slug === slug)
  assert.ok(a, `agent ${slug} exists`)
  return a
}

const lastHeading = (prompt: string) => prompt.match(/^## .+$/gm)?.at(-1)

test('creative-director validates against the real workspace', () => {
  const { chain, agents, chains, tools, skills } = workspace()
  const result = validateChain(chain, agents, chains, tools, skills)
  assert.deepStrictEqual(result.errors, [])
  assert.strictEqual(chain.view, 'columns')
  assert.ok(chain.parameter, 'declares the experimental dial')
  assert.ok(chain.nodes.some(n => n.kind === 'context'), 'has a canon context node')
  assert.strictEqual(chain.nodes.find(n => n.id === 'creative-director')?.kind, 'decider')
})

test('every proposer prompt ends by asking for a Proposed canon section', () => {
  const { agents } = workspace()
  for (const slug of PROPOSERS) {
    const a = agentOf(agents, slug)
    assert.strictEqual(lastHeading(a.systemPrompt), '## Proposed canon', `${slug} ends with ## Proposed canon`)
  }
})

test('the creative director prompt forces the verdict sections and declares them as sockets', () => {
  const { agents } = workspace()
  const cd = agentOf(agents, 'creative-director')
  for (const s of VERDICT_SECTIONS) assert.ok(cd.systemPrompt.includes(`## ${s}`), `prompt names ## ${s}`)
  const sockets = cd.outputs.map(o => o.name.toLowerCase())
  for (const s of VERDICT_SECTIONS) assert.ok(sockets.includes(s.toLowerCase()), `declares ${s} output`)
  assert.match(cd.systemPrompt, /coheren/i, 'instructed to protect coherence')
})

test('a stubbed run yields a columns layout: one panel per proposer plus the verdict', async () => {
  const { chain, agents, chains, tools, skills } = workspace()
  const reply = (a: AgentDef) => a.slug === 'creative-director'
    ? VERDICT_SECTIONS.map(s => `## ${s}\n${s} body`).join('\n\n')
    : `## Take\n${a.slug} take\n\n## Proposed canon\n- ${a.slug} line`
  const stub = (async (a: AgentDef, sys: string) => ({
    agentName: a.name, systemPrompt: sys, input: '', output: reply(a),
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }) as AgentOutput) as never
  const noop = { onStart() {}, onToken() {}, onDone() {} }

  const seed = 'anime girl with a giant mechanical halo'
  const dial = chain.parameter!.options[2]
  const results = await runChainGraph(chain, agents, skills, seed,
    '/nonexistent', noop, stub, [], chains, tools, 0, dial)

  // An empty brief must not leave a proposer with nothing to read.
  for (const id of [...PROPOSERS, 'creative-director']) {
    assert.ok(results.find(r => r.nodeId === id)!.systemPrompt.includes(seed), `${id} reads the seed directly`)
  }
  const cd = results.find(r => r.nodeId === 'creative-director')!
  for (const slug of PROPOSERS) assert.ok(cd.systemPrompt.includes(`${slug} take`), `verdict read ${slug}`)
  const brief = results.find(r => r.nodeId === 'creative-brief')!
  assert.ok(brief.systemPrompt.includes(dial), 'brief received the dial pick')

  const layout = buildLayoutModel(chain, results)
  assert.strictEqual(layout.kind, 'columns')
  assert.deepStrictEqual(layout.panels.map(p => p.node), [...PROPOSERS, 'creative-director'])
  assert.ok(layout.panels.every(p => p.state === 'filled'), 'every panel filled')
  assert.strictEqual(layout.panels.at(-1)!.emphasis, 'join')
  for (const p of layout.panels.slice(0, -1)) {
    assert.ok(extractSections(p.text).includes('proposed-canon'), `${p.node} panel keeps canon`)
  }
})
