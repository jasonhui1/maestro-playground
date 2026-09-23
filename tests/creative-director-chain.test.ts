import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import { loadWorkspace } from '../lib/fs/workspace'
import { validateChain } from '../lib/chainGraph'
import { runChainGraph } from '../lib/executor'
import { buildLayoutModel } from '../lib/layoutModel'
import { extractSections } from '../lib/graph'
import { answerHold } from '../lib/hold'
import type { AgentDef, AgentOutput, ChainDef, HoldRecord, RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'

// #78: the hold reads these panels and offers CANON? ticks from each proposer.
const PROPOSERS = ['character-director', 'gameplay-director', 'world-director', 'art-director', 'devils-advocate']
const VERDICT_SECTIONS = ['Creative Thesis', 'Player Fantasy', 'Pillars', 'Kill List', 'Greenlight Concept']
const PITCH_SECTIONS = ['Built on', 'Direction applied', 'Greenlight Pitch']
const CANDIDATES = ['Candidate 1', 'Candidate 2', 'Candidate 3']

const DIRECTION = [
  'KEEP: fast combat, halo segments as weapons',
  'CHANGE: halo is a burden not a toolkit; using a segment has a permanent cost',
  'KILL: stance switching',
  'PUSH: broken-crown silhouette',
].join('\n')

const CANON = '## LOCKED\n- halo = burden\n\n## UNRESOLVED\n\n## REJECTED\n- gacha monetisation'

// Only the model is stubbed; the executor, routes and logger are real.
const ran: string[] = []
const reply = (slug: string) => {
  if (slug === 'creative-director') return [...VERDICT_SECTIONS, ...CANDIDATES].map(s => `## ${s}\n${s} body`).join('\n\n')
  if (slug === 'idea-maker') return CANDIDATES.map(s => `## ${s}\n${s} body`).join('\n\n')
  if (slug === 'creative-brief') return '## Seed\nCandidate 2 body\n\n## Fixed\nChosen idea drives the brief'
  if (slug === 'greenlight') return PITCH_SECTIONS.map(s => `## ${s}\n${s} body`).join('\n\n')
  return `## Take\n${slug} take\n\n## Proposed canon\n- ${slug} line`
}
const stub = async (a: AgentDef, sys: string): Promise<AgentOutput> => {
  ran.push(a.slug)
  return {
    agentName: a.name, systemPrompt: sys, input: '', output: reply(a.slug),
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: new Date().toISOString(), status: 'success',
  }
}
vi.mock('@/lib/runner', () => ({ runAgent: (a: AgentDef, sys: string) => stub(a, sys) }))

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

const REAL_WORKSPACE = path.resolve(__dirname, '../workspace')

afterEach(() => {
  ran.length = 0
})

function workspace() {
  const ws = loadWorkspace(REAL_WORKSPACE)
  const chain = ws.chains.find(c => c.slug === 'creative-director')
  assert.ok(chain, 'creative-director chain exists')
  return { ...ws, chain }
}

const agentOf = (agents: AgentDef[], slug: string) => {
  const a = agents.find(x => x.slug === slug)
  assert.ok(a, `agent ${slug} exists`)
  return a
}

const edgesOf = (chain: ChainDef) => chain.edges.map(e => `${e.fromNode} -> ${e.toNode}.${e.toSocket}`)

const lastHeading = (prompt: string) => prompt.match(/^## .+$/gm)?.at(-1)

const noop = { onStart() {}, onToken() {}, onDone() {} }

test('creative-director validates against the real workspace', () => {
  const { chain, agents, chains, tools, skills } = workspace()
  const result = validateChain(chain, { agents, chains, tools, skills })
  assert.deepStrictEqual(result.errors, [])
  assert.strictEqual(chain.view, 'columns')
  assert.ok(chain.parameter, 'declares the experimental dial')
  assert.ok(chain.nodes.some(n => n.kind === 'context'), 'has a canon context node')
  assert.strictEqual(chain.nodes.find(n => n.id === 'creative-director')?.kind, 'decider')
})

test('one chain: the decider feeds a hold, the hold directs greenlight, greenlight reports (#95)', () => {
  const { chain, chains } = workspace()
  assert.strictEqual(chains.find(c => c.slug === 'develop-direction'), undefined, 'develop-direction is gone')
  assert.strictEqual(chain.nodes.find(n => n.id === 'hold')?.kind, 'hold')
  assert.strictEqual(chain.nodes.find(n => n.id === 'hold-idea')?.kind, 'hold')
  assert.strictEqual(chain.nodes.find(n => n.id === 'idea-maker')?.kind, 'decider')
  const greenlight = chain.nodes.find(n => n.id === 'greenlight')
  assert.ok(greenlight?.kind === 'agent' && greenlight.agent === 'greenlight')

  const edges = edgesOf(chain)
  for (const e of [
    'idea-maker -> hold-idea.in',
    'hold-idea -> creative-brief.seed',
    'creative-director -> hold.in',
    'hold -> greenlight.direction',
    'canon -> greenlight.canon',
    'greenlight -> report.in',
  ]) assert.ok(edges.includes(e), `wires ${e}`)
  for (const id of [...PROPOSERS, 'creative-director']) {
    assert.ok(edges.includes(`creative-brief -> ${id}.seed`), `${id} reads the selected idea`)
  }
  assert.ok(agentOf(workspace().agents, 'creative-brief').outputs.some(o => o.name === 'seed'), 'brief publishes the selected idea')
  assert.strictEqual(edges.filter(e => e.endsWith('report.in')).length, 1, 'report reads the pitch alone')

  const pitch = chain.outputs?.find(o => o.name === 'pitch')
  assert.strictEqual(pitch?.node, 'greenlight')
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

test('the creative director prompt ends with three candidates for the hold to offer (#96)', () => {
  const { agents } = workspace()
  const headings = agentOf(agents, 'creative-director').systemPrompt.match(/^## .+$/gm) ?? []
  assert.deepStrictEqual(headings.slice(-3), CANDIDATES.map(c => `## ${c}`))
})

test('the greenlight prompt builds on the PICK line and skips empty verb lines (#96)', () => {
  const { agents } = workspace()
  const prompt = agentOf(agents, 'greenlight').systemPrompt
  assert.match(prompt, /PICK:/)
  assert.match(prompt, /nothing after the colon/i)
  assert.match(prompt, /write `- None`/, 'an empty Direction applied still says so')
})

test('the greenlight prompt refuses KILL and REJECTED and cites KEEP lines', () => {
  const { agents } = workspace()
  const greenlight = agentOf(agents, 'greenlight')
  const prompt = greenlight.systemPrompt
  assert.match(prompt, /KILL/)
  assert.match(prompt, /REJECTED/)
  assert.match(prompt, /KEEP/)
  for (const s of PITCH_SECTIONS) assert.ok(prompt.includes(`## ${s}`), `prompt names ## ${s}`)
  const sockets = greenlight.outputs.map(o => o.name.toLowerCase())
  for (const s of PITCH_SECTIONS) assert.ok(sockets.includes(s.toLowerCase()), `declares ${s} output`)
})

test('a stubbed run stops at the hold with the columns filled, then resumes into the pitch', async () => {
  const { chain, agents, chains, tools, skills } = workspace()
  const holds: HoldRecord[] = []
  const callbacks = { ...noop, onHold: (h: HoldRecord) => holds.push(h) }

  const seed = 'anime girl with a giant mechanical halo'
  const dial = chain.parameter!.options[2]
  const canonFile = chain.nodes.find(n => n.id === 'canon')!
  assert.ok(canonFile.kind === 'context' && canonFile.file)
  const overrides = { [canonFile.file]: CANON }
  const results = await runChainGraph(chain, { agents, skills, chains, tools, root: '/nonexistent' },
    callbacks, { seedPrompt: seed, run: stub as never, paramValue: dial, context: overrides })

  assert.deepStrictEqual(holds.map(h => h.nodeId), ['hold-idea'])
  assert.ok(results.some(r => r.nodeId === 'idea-maker'))
  assert.ok(!results.some(r => r.nodeId === 'creative-brief' || r.nodeId === 'greenlight'), 'nothing after first hold ran')

  const { output: answerIdea } = answerHold(holds, holds[0], '', { candidate: { heading: 'Candidate 2', body: 'Candidate 2 body' } })
  const secondHolds: HoldRecord[] = []
  const secondCallbacks = { ...noop, onHold: (h: HoldRecord) => secondHolds.push(h) }
  const secondResults = await runChainGraph(chain, { agents, skills, chains, tools, root: '/nonexistent' },
    secondCallbacks, { seedPrompt: seed, run: stub as never, replay: [...results, answerIdea], paramValue: dial, context: overrides })

  for (const id of [...PROPOSERS, 'creative-director']) {
    const prompt = secondResults.find(r => r.nodeId === id)!.systemPrompt
    assert.ok(prompt.includes('Candidate 2 body'), `${id} reads the selected idea`)
    assert.ok(!prompt.includes(seed), `${id} does not read the original hint`)
  }
  const cd = secondResults.find(r => r.nodeId === 'creative-director')!
  for (const slug of PROPOSERS) assert.ok(cd.systemPrompt.includes(`${slug} take`), `verdict read ${slug}`)
  const brief = secondResults.find(r => r.nodeId === 'creative-brief')!
  assert.ok(brief.systemPrompt.includes(dial), 'brief received the dial pick')

  assert.deepStrictEqual(secondHolds.map(h => h.nodeId), ['hold'])
  assert.strictEqual(secondHolds[0].input, cd.output, 'the hold is asked about the verdict')
  assert.ok(!secondResults.some(r => r.nodeId === 'greenlight' || r.nodeId === 'report'), 'nothing after second hold ran')

  let layout = buildLayoutModel(chain, secondResults)
  assert.strictEqual(layout.kind, 'columns')
  assert.deepStrictEqual(layout.panels.map(p => p.node), [...PROPOSERS, 'creative-director', 'greenlight'])
  assert.ok(layout.panels.slice(0, -1).every(p => p.state === 'filled'), 'specialists and verdict filled')
  assert.strictEqual(layout.panels.at(-1)!.state, 'pending', 'pitch waits on the hold')
  assert.strictEqual(layout.panels.at(-2)!.emphasis, 'join')
  for (const p of layout.panels.slice(0, PROPOSERS.length)) {
    assert.ok(extractSections(p.text).includes('proposed-canon'), `${p.node} panel keeps canon`)
  }

  const { output: answerDirection } = answerHold(secondHolds, secondHolds[0], DIRECTION)
  const resumed = await runChainGraph(chain, { agents, skills, chains, tools, root: '/nonexistent' },
    noop, { seedPrompt: seed, run: stub as never, replay: [...secondResults, answerDirection], paramValue: dial, context: overrides })

  const greenlight = resumed.find(r => r.nodeId === 'greenlight')!
  assert.ok(greenlight.systemPrompt.includes(DIRECTION), 'greenlight reads the whole Direction')
  assert.ok(greenlight.systemPrompt.includes('gacha monetisation'), 'greenlight reads canon from the request')
  const report = resumed.find(r => r.nodeId === 'report')!
  assert.ok(report.output.includes('Greenlight Pitch body'), 'report carries the pitch')

  layout = buildLayoutModel(chain, resumed)
  assert.ok(layout.panels.every(p => p.state === 'filled'), 'every panel filled after resume')
  assert.ok(layout.panels.at(-1)!.text.includes('Greenlight Pitch body'))
})

// A copy of the real workspace, so the route run writes logs somewhere disposable.
function copyWorkspace(): string {
  const src = REAL_WORKSPACE
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-creative-director-'))
  for (const dir of ['agents', 'chains', 'context', 'skills', 'templates', 'tools']) {
    const from = path.join(src, dir)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(wp, dir), { recursive: true })
  }
  requestEntry.root = wp
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

test('end to end: the run stops, resumes with a Direction, and the pitch lands in the same run', async () => {
  const wp = copyWorkspace()
  const { POST: run } = await import('../app/api/run/route')
  const started = await sse(await run({
    json: async () => ({ chainName: 'creative-director', seedPrompt: 'anime girl with a giant mechanical halo' }),
  } as import('next/server').NextRequest))
  const waiting1 = started.at(-1)!
  assert.strictEqual(waiting1.type, 'run_waiting')
  assert.strictEqual(waiting1.nodeId, 'hold-idea')
  const runId = waiting1.runId as string
  assert.ok(!ran.includes('creative-brief'), 'creative-brief waits for hold-idea')
  ran.length = 0

  const { POST: resume } = await import('../app/api/runs/[runId]/resume/route')
  const resumed1 = await sse(await resume(
    { json: async () => ({ holdId: 'hold-idea', chosen: 'Candidate 1' }) } as import('next/server').NextRequest,
    { params: Promise.resolve({ runId }) },
  ))
  const waiting2 = resumed1.at(-1)!
  assert.strictEqual(waiting2.type, 'run_waiting')
  assert.strictEqual(waiting2.nodeId, 'hold')
  assert.ok(!ran.includes('greenlight'), 'greenlight waits for the second hold')
  ran.length = 0

  const resumed2 = await sse(await resume(
    { json: async () => ({ holdId: 'hold', chosen: 'Candidate 2', direction: DIRECTION }) } as import('next/server').NextRequest,
    { params: Promise.resolve({ runId }) },
  ))
  assert.strictEqual(resumed2.at(-1)!.type, 'run_complete')
  assert.strictEqual(resumed2.at(-1)!.runId, runId)
  assert.deepStrictEqual(ran, ['greenlight'], 'only what follows the second hold executes')

  const dir = path.join(wp, 'logs', runId)
  const logs = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()
  const greenlightLog = logs.find(f => f.endsWith('-greenlight.md'))
  assert.ok(greenlightLog, `greenlight log in ${logs.join(', ')}`)
  const holdLog = logs.find(f => f.endsWith('-hold.md'))
  assert.ok(holdLog, 'hold log written')
  const holdText = `PICK: Candidate 2\nCandidate 2 body\n\n${DIRECTION}`
  const hold = matter(fs.readFileSync(path.join(dir, holdLog), 'utf-8'))
  assert.strictEqual(hold.content.trim(), holdText)
  assert.strictEqual(hold.data.chosen, 'Candidate 2')
  assert.ok(logs.some(f => f.endsWith('-report.md')))
  const log = matter(fs.readFileSync(path.join(dir, greenlightLog), 'utf-8'))
  assert.ok(log.content.includes('Greenlight Pitch body'), 'pitch is in the greenlight log')
  assert.ok((log.data.system_prompt as string).replace(/\r\n/g, '\n').includes(`<direction>\n${holdText}`), 'greenlight reads the pick first')

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as RunMeta
  assert.strictEqual(meta.status, 'complete')
  const directionHold = meta.holds?.find(h => h.nodeId === 'hold')
  assert.strictEqual(directionHold?.direction, DIRECTION)
  assert.strictEqual(directionHold?.chosen, 'Candidate 2')
})

test('end to end: blank seed produces idea candidates and halts at first hold', async () => {
  const wp = copyWorkspace()
  const { POST: run } = await import('../app/api/run/route')
  const started = await sse(await run({
    json: async () => ({ chainName: 'creative-director', seedPrompt: '' }),
  } as import('next/server').NextRequest))
  const waiting = started.at(-1)!
  assert.strictEqual(waiting.type, 'run_waiting')
  assert.strictEqual(waiting.nodeId, 'hold-idea')
  const runId = waiting.runId as string

  const held = JSON.parse(fs.readFileSync(path.join(wp, 'logs', runId, 'meta.json'), 'utf-8')) as RunMeta
  assert.deepStrictEqual(held.holds?.[0].candidates.map(c => c.heading), CANDIDATES)
  assert.ok(held.holds![0].candidates.every(c => c.body), 'each candidate has a body')
})
