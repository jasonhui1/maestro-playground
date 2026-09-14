import { test } from 'vitest'
import assert from 'node:assert'
import { loadWorkspace } from '../lib/fs/workspace'
import { validateChain } from '../lib/chainGraph'
import { runChainGraph } from '../lib/executor'
import type { AgentDef, AgentOutput, ChainDef } from '../lib/types'

// #80: resume from a hold. Seed is the human's Direction block, context is canon.
const PITCH_SECTIONS = ['Built on', 'Direction applied', 'Greenlight Pitch']

const DIRECTION = [
  'KEEP: fast combat, halo segments as weapons',
  'CHANGE: halo is a burden not a toolkit; using a segment has a permanent cost',
  'KILL: stance switching',
  'PUSH: broken-crown silhouette',
].join('\n')

const CANON = '## LOCKED\n- halo = burden\n\n## UNRESOLVED\n\n## REJECTED\n- gacha monetisation'

function workspace() {
  const ws = loadWorkspace()
  const chain = ws.chains.find(c => c.slug === 'develop-direction')
  assert.ok(chain, 'develop-direction chain exists')
  const greenlight = ws.agents.find(a => a.slug === 'greenlight')
  assert.ok(greenlight, 'greenlight agent exists')
  return { ...ws, chain, greenlight }
}

type NodeKind = ChainDef['nodes'][number]['kind']
const nodeOfKind = <K extends NodeKind>(chain: ChainDef, kind: K) => {
  const n = chain.nodes.find((x): x is Extract<ChainDef['nodes'][number], { kind: K }> => x.kind === kind)
  assert.ok(n, `${chain.slug} has a ${kind} node`)
  return n
}

test('develop-direction validates and stays small: seed, canon, greenlight, report', () => {
  const { chain, agents, chains, tools, skills } = workspace()
  assert.deepStrictEqual(validateChain(chain, agents, chains, tools, skills).errors, [])
  assert.deepStrictEqual(
    chain.nodes.map(n => n.kind).sort(),
    ['agent', 'context', 'report', 'seed'],
  )
  const conceptRoom = chains.find(c => c.slug === 'creative-director')!
  assert.strictEqual(nodeOfKind(chain, 'context').file, nodeOfKind(conceptRoom, 'context').file,
    'same canon file as the concept room')
})

test('the greenlight prompt refuses KILL and REJECTED and cites KEEP lines', () => {
  const { greenlight } = workspace()
  const prompt = greenlight.systemPrompt
  assert.match(prompt, /KILL/)
  assert.match(prompt, /REJECTED/)
  assert.match(prompt, /KEEP/)
  for (const s of PITCH_SECTIONS) assert.ok(prompt.includes(`## ${s}`), `prompt names ## ${s}`)
  const sockets = greenlight.outputs.map(o => o.name.toLowerCase())
  for (const s of PITCH_SECTIONS) assert.ok(sockets.includes(s.toLowerCase()), `declares ${s} output`)
})

test('a stubbed run hands the Direction and the request canon to greenlight, and reports its pitch', async () => {
  const { chain, agents, chains, tools, skills, greenlight } = workspace()
  const pitch = PITCH_SECTIONS.map(s => `## ${s}\n${s} body`).join('\n\n')
  const stub = (async (a: AgentDef, sys: string) => ({
    agentName: a.name, systemPrompt: sys, input: '', output: pitch,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }) as AgentOutput) as never
  const noop = { onStart() {}, onToken() {}, onDone() {} }
  const canonFile = nodeOfKind(chain, 'context').file!

  const results = await runChainGraph(chain, agents, skills, DIRECTION,
    '/nonexistent', noop, stub, [], chains, tools, 0, '', { [canonFile]: CANON })

  const agentNode = nodeOfKind(chain, 'agent')
  assert.strictEqual(agentNode.agent, greenlight.slug)
  const greenlightRun = results.find(r => r.nodeId === agentNode.id)!
  assert.ok(greenlightRun.systemPrompt.includes(DIRECTION), 'greenlight reads the whole Direction block')
  assert.ok(greenlightRun.systemPrompt.includes('gacha monetisation'), 'greenlight reads canon from the request')

  const report = results.find(r => r.nodeId === nodeOfKind(chain, 'report').id)!
  assert.ok(report.output.includes('Greenlight Pitch body'), 'report carries the pitch')
})
