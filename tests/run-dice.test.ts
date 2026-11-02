import { test, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NextRequest } from 'next/server'
import type { AgentOutput, RunMeta } from '../lib/types'
import type { LayoutModel } from '../lib/layoutModel'
import { answer, fakeModel } from './helpers/fakeModel'
import { requestEntry } from './helpers/requestWorkspace'
import { splitFrontmatter } from '../lib/editedFile'
import { saveWorkspaceEntity } from '../lib/fs/save'
import { parseAgent } from '../lib/fs/parseAgent'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

// Echoing the resolved system prompt back as output lets a test read off what was rolled.
requestEntry.model = fakeModel(({ system }) => answer(system)).model

const CULTURES = ['Edo Japan', 'Tang China', 'Joseon Korea', 'Mughal India', 'Ottoman Anatolia', 'Song China', 'Heian Japan', 'Khmer Angkor']
const HAIR = ['short bob', 'twin tails', 'wild curls', 'braided crown', 'undercut', 'hime cut', 'long ponytail', 'buzz cut']

const designer = `---
name: Designer
dice:
  culture: [${CULTURES.join(', ')}]
  hair: [${HAIR.join(', ')}]
  styling: { values: [belt slung low, stacked belts, sash, harness], draws: 2 }
---
Design a character for {input}.

{dice}
`

const pairChain = `---
name: pair
view: columns
nodes:
  - id: seed
    kind: seed
  - id: first
    kind: agent
    agent: designer
  - id: second
    kind: agent
    agent: designer
  - id: judge
    kind: agent
    agent: judge
edges:
  - from: seed
    to: first.input
  - from: seed
    to: second.input
  - from: first
    to: judge.a
  - from: second
    to: judge.b
outputs:
  - name: First
    node: first
  - name: Second
    node: second
  - name: Verdict
    node: judge
---
`

function newWorkspace(): string {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-dice-'))
  requestEntry.root = wp
  const write = (rel: string, body: string) => {
    const p = path.join(wp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  write('agents/designer.md', designer)
  write('agents/appended.md', '---\nname: Appended\ndice:\n  hair: [short bob]\n---\nDesign {input}.\n')
  write('agents/judge.md', '---\nname: Judge\n---\nCompare {a} and {b}.\n')
  write('chains/pair.md', pairChain)
  return wp
}

type Event = { type: string; [k: string]: unknown }

async function sse(res: Response): Promise<Event[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await new Response(res.body).text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

async function run(body: object): Promise<Response> {
  const { POST } = await import('../app/api/run/route')
  return POST({ json: async () => body } as NextRequest)
}

async function readMeta(runId: string): Promise<RunMeta> {
  const { GET } = await import('../app/api/runs/[runId]/route')
  return await (await GET({} as NextRequest, { params: Promise.resolve({ runId }) })).json() as RunMeta
}

async function fork(runId: string, body: object): Promise<Event[]> {
  const { POST } = await import('../app/api/runs/[runId]/fork/route')
  return sse(await POST({ json: async () => body } as NextRequest, { params: Promise.resolve({ runId }) }))
}

const runIdOf = (events: Event[]) => events.find(e => e.type === 'run_start')!.runId as string
const outputOf = (events: Event[], nodeId: string) =>
  (events.find(e => e.type === 'agent_done' && e.nodeId === nodeId)!.output as AgentOutput).output

test('an agent run fills {dice} with one rolled line per axis and pins the roll', async () => {
  newWorkspace()
  const events = await sse(await run({ agentName: 'designer', seedPrompt: 'a festival' }))
  const meta = await readMeta(runIdOf(events))
  const roll = meta.dice?.designer
  assert.ok(roll, JSON.stringify(meta.dice))
  assert.ok(CULTURES.includes(roll.culture[0]) && roll.culture.length === 1)
  assert.strictEqual(roll.styling.length, 2)
  assert.strictEqual(outputOf(events, 'designer'),
    `Design a character for a festival.\n\n- culture: ${roll.culture[0]}\n- hair: ${roll.hair[0]}\n- styling: ${roll.styling.join(', ')}`)
})

test('a slotless agent rolls dice without a seed and streams the rolls on run_start', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/slotless.md'), designer.replace(' for {input}', ''))
  const events = await sse(await run({ agentName: 'slotless' }))
  const meta = await readMeta(runIdOf(events))
  const roll = meta.dice?.slotless
  assert.ok(roll)
  assert.ok(CULTURES.includes(roll.culture[0]) && roll.culture.length === 1)
  assert.ok(HAIR.includes(roll.hair[0]) && roll.hair.length === 1)
  assert.strictEqual(roll.styling.length, 2)
  assert.deepStrictEqual(events[0].dice, meta.dice)
  assert.strictEqual(outputOf(events, 'slotless'),
    `Design a character.\n\n- culture: ${roll.culture[0]}\n- hair: ${roll.hair[0]}\n- styling: ${roll.styling.join(', ')}`)
  assert.strictEqual(events.filter(e => e.type === 'agent_done').length, 1)
  assert.strictEqual(events.at(-1)?.type, 'run_complete')
})

test('a slotless agent accepts dice pins and keeps them when its saved graph is forked', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/slotless.md'), designer.replace(' for {input}', ''))
  const events = await sse(await run({ agentName: 'slotless', seedPrompt: 'IGNORED', dice: {
    culture: 'Atlantis', hair: 'mohawk', styling: 'sash',
  } }))
  const expectedDice = { slotless: { culture: ['Atlantis'], hair: ['mohawk'], styling: ['sash'] } }
  const expectedOutput = 'Design a character.\n\n- culture: Atlantis\n- hair: mohawk\n- styling: sash'
  const source = await readMeta(runIdOf(events))
  assert.deepStrictEqual(source.dice, expectedDice)
  assert.deepStrictEqual(events[0].dice, expectedDice)
  assert.strictEqual(outputOf(events, 'slotless'), expectedOutput)
  for (const versions of ['current', 'pinned']) {
    const forked = await fork(source.runId, { from: 'slotless', versions })
    const meta = await readMeta(runIdOf(forked))
    assert.deepStrictEqual(meta.graph, { nodes: [{ id: 'slotless', kind: 'agent', agent: 'slotless' }], edges: [] })
    assert.deepStrictEqual(meta.dice, expectedDice)
    assert.deepStrictEqual(forked[0].dice, expectedDice)
    assert.strictEqual(outputOf(forked, 'slotless'), expectedOutput)
    assert.strictEqual(forked.at(-1)?.type, 'run_complete')
    assert.strictEqual(meta.branchedFromRunId, source.runId)
    assert.strictEqual(meta.branchedFromNode, 'slotless')
  }
})

// A direct agent run declares no layout, so its panels cannot carry the roll (#155).
test('a direct agent run\'s run_start carries its rolls, and omits dice when nothing rolled', async () => {
  newWorkspace()
  const events = await sse(await run({ agentName: 'designer', seedPrompt: 'a festival' }))
  const meta = await readMeta(runIdOf(events))
  assert.deepStrictEqual(events.find(e => e.type === 'run_start')!.dice, meta.dice)

  const plain = await sse(await run({ agentName: 'judge', seedPrompt: 'X' }))
  assert.ok(!('dice' in plain.find(e => e.type === 'run_start')!))
})

test('an agent with dice but no {dice} token gets the lines after its body', async () => {
  newWorkspace()
  const events = await sse(await run({ agentName: 'appended', seedPrompt: 'X' }))
  assert.strictEqual(outputOf(events, 'appended'), 'Design X.\n\n- hair: short bob')
})

test('an agent without dice behaves as before and pins no roll', async () => {
  newWorkspace()
  const events = await sse(await run({ agentName: 'judge', seedPrompt: 'X' }))
  assert.strictEqual(outputOf(events, 'judge'), 'Compare X and X.')
  assert.strictEqual((await readMeta(runIdOf(events))).dice, undefined)
})

test('{dice} is no input: not a workspace slot, not a node socket; the workspace lists axes', async () => {
  newWorkspace()
  const { GET } = await import('../app/api/workspace/route')
  const body = await (await GET()).json() as {
    agents: { slug: string; slots: string[]; dice?: Record<string, { values: string[]; draws: unknown }> }[]
    capabilities: Record<string, boolean>
  }
  const agent = body.agents.find(a => a.slug === 'designer')!
  assert.deepStrictEqual(agent.slots, ['input'])
  assert.deepStrictEqual(agent.dice?.culture, { values: CULTURES, draws: 1 })
  assert.deepStrictEqual(agent.dice?.styling.draws, 2)
  assert.strictEqual(body.capabilities.dice, true)

  const { kindOf } = await import('../lib/nodeKinds')
  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace(requestEntry.root)
  const node = { id: 'd', kind: 'agent' as const, agent: 'designer' }
  assert.deepStrictEqual(kindOf('agent').inputs(node, { chain: { slug: 'x', name: 'x', description: '', nodes: [node], edges: [], filePath: '' }, agents: ws.agents, chains: ws.chains }).map(s => s.name), ['input'])
})

test('the same agent twice in a chain rolls twice; every layout frame carries each panel\'s roll', async () => {
  newWorkspace()
  const events = await sse(await run({ chainName: 'pair', seedPrompt: 'a festival' }))
  const meta = await readMeta(runIdOf(events))
  assert.deepStrictEqual(Object.keys(meta.dice ?? {}).sort(), ['first', 'second'])

  const frames = events.filter(e => e.type === 'layout').map(e => e.model as LayoutModel)
  assert.ok(frames.length > 1)
  for (const frame of frames) {
    const byNode = new Map(frame.panels.map(p => [p.node, p]))
    assert.deepStrictEqual(byNode.get('first')?.dice, meta.dice!.first)
    assert.deepStrictEqual(byNode.get('second')?.dice, meta.dice!.second)
    assert.strictEqual(byNode.get('judge')?.dice, undefined)
  }
  const { GET } = await import('../app/api/runs/[runId]/layout/route')
  const stored = await (await GET({} as NextRequest, { params: Promise.resolve({ runId: meta.runId }) })).json() as LayoutModel
  assert.deepStrictEqual(stored.panels.find(p => p.node === 'first')?.dice, meta.dice!.first)
})

test('each copy of a variance group rolls its own, recorded in its meta.json and its frames', async () => {
  newWorkspace()
  const { POST } = await import('../app/api/variance/route')
  const events = await sse(await POST({ json: async () => ({ agentName: 'designer', seedPrompt: 'a festival', count: 8 }) } as NextRequest))
  const runIds = events.find(e => e.type === 'variance_complete')!.runIds as string[]
  const rolls = await Promise.all(runIds.map(async id => (await readMeta(id)).dice?.designer))
  assert.ok(rolls.every(Boolean))
  assert.ok(new Set(rolls.map(r => JSON.stringify(r))).size > 1, 'eight copies all rolled the same')
  for (const [instance, roll] of rolls.entries()) {
    const out = events.find(e => e.type === 'agent_done' && e.instance === instance)!.output as AgentOutput
    assert.match(out.output, new RegExp(`- culture: ${roll!.culture[0]}`))
  }
})

test('request pins fix or narrow an axis on every node declaring it; an undeclared axis is a 400', async () => {
  newWorkspace()
  const pinned = await readMeta(runIdOf(await sse(await run({
    chainName: 'pair', seedPrompt: 'X', dice: { culture: 'Atlantis', hair: ['undercut', 'buzz cut'] },
  }))))
  for (const node of ['first', 'second']) {
    assert.deepStrictEqual(pinned.dice![node].culture, ['Atlantis'])
    assert.ok(['undercut', 'buzz cut'].includes(pinned.dice![node].hair[0]))
  }

  const res = await run({ agentName: 'designer', seedPrompt: 'X', dice: { tail: 'long' } })
  assert.strictEqual(res.status, 400)
  assert.match((await res.json() as { error: string }).error, /"tail"/)
  const bad = await run({ agentName: 'designer', seedPrompt: 'X', dice: { hair: 5 } })
  assert.strictEqual(bad.status, 400)
})

test('the agent editor round-trips the dice block', () => {
  const wp = newWorkspace()
  const file = path.join(wp, 'agents/designer.md')
  const split = splitFrontmatter(fs.readFileSync(file, 'utf-8'))!
  saveWorkspaceEntity(wp, { type: 'agent', slug: 'designer', data: split.data, content: split.content })
  assert.deepStrictEqual(parseAgent(file).dice, parseAgent(file, designer).dice)
})

test('a dice socket carries a roll into another node\'s slot, and its `by` rolls against it (#161)', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'agents/roles.md'), '---\nname: Roles\ndice:\n  role: [knight, thief, chef]\n---\nDesign {input}.\n')
  fs.writeFileSync(path.join(wp, 'agents/profile.md'), `---
name: Profile
dice:
  weapon:
    by: role
    values:
      lance: { fits: [knight] }
      sword cane: { fits: [thief] }
---
Built from:
{design_dice}
Rolled:
{dice}
`)
  fs.writeFileSync(path.join(wp, 'chains/wired.md'), `---
name: wired
nodes:
  - id: seed
    kind: seed
  - id: designer
    kind: agent
    agent: roles
  - id: profile
    kind: agent
    agent: profile
edges:
  - from: seed
    to: designer.input
  - from: designer.dice
    to: profile.design_dice
---
`)
  const thief = await sse(await run({ chainName: 'wired', seedPrompt: 'X', dice: { role: 'thief' } }))
  assert.strictEqual(outputOf(thief, 'profile'), 'Built from:\n- role: thief\nRolled:\n- weapon: sword cane')
  const chef = await sse(await run({ chainName: 'wired', seedPrompt: 'X', dice: { role: 'chef' } }))
  assert.strictEqual(outputOf(chef, 'profile'), 'Built from:\n- role: chef\nRolled:\n')

  const source = await readMeta(runIdOf(thief))
  for (const from of ['profile', 'designer']) {
    const forked = await fork(source.runId, { from })
    assert.deepStrictEqual((await readMeta(runIdOf(forked))).dice, source.dice, `fork from ${from}`)
    assert.strictEqual(outputOf(forked, 'profile'), 'Built from:\n- role: thief\nRolled:\n- weapon: sword cane')
  }
})

test('a subchain\'s inner node rolls under the subchain node\'s id, and that roll is the one it ran with', async () => {
  const wp = newWorkspace()
  fs.writeFileSync(path.join(wp, 'chains/inner.md'), `---
name: inner
nodes:
  - id: seed
    kind: seed
  - id: d
    kind: agent
    agent: appended
edges:
  - from: seed
    to: d.input
inputs:
  - name: topic
    node: seed
outputs:
  - name: design
    node: d
---
`)
  fs.writeFileSync(path.join(wp, 'chains/outer.md'), `---
name: outer
nodes:
  - id: seed
    kind: seed
  - id: sub
    kind: subchain
    subchain: inner
edges:
  - from: seed
    to: sub.topic
---
`)
  const events = await sse(await run({ chainName: 'outer', seedPrompt: 'X', dice: { hair: 'mohawk' } }))
  assert.deepStrictEqual((await readMeta(runIdOf(events))).dice, { 'sub/d': { hair: ['mohawk'] } })
  const { runs } = (await import('./helpers/requestWorkspace')).requestWorkspace()
  const design = runs.read(runIdOf(events)).agentOutputs.find(o => o.nodeId === 'sub::design')
  assert.strictEqual(design?.output, 'Design X.\n\n- hair: mohawk')
})
