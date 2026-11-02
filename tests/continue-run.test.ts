import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import matter from 'gray-matter'
import { continueRun, type ContinuePlan } from '../lib/continueRun'
import { saveFeedback, type RerollRequest } from '../lib/reroll'
import { readAnswerRequest, type AnswerRequest } from '../lib/hold'
import { readForkRequest } from '../lib/fork'
import { toResponse } from '../lib/refusal'
import { parseChainContent } from '../lib/parseChain'
import { normalizeDice } from '../lib/dice'
import { stepLog } from '../lib/logger'
import { agentSlots } from '../lib/tokens'
import { startRun, type LiveWorkspace } from '../lib/runSession'
import { memoryWorkspace } from '../lib/runFolders'
import { prepareRunRequest, type RunRequestBody } from '../lib/runRequest'
import type { AgentDef, AgentOutput, ChainDef, ChatMessage, HoldRecord, RunMeta } from '../lib/types'

// The run folders, version snapshots and model are in memory; the executor and the continuation are real.
let nextId = 0
vi.mock('@/lib/logger', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/logger')>(),
  newRunId: () => `run-${++nextId}`,
}))


type Model = (agent: AgentDef, systemPrompt: string) => string | Promise<string>
const defaultModel: Model = (agent, systemPrompt) =>
  agent.slug === 'decider' ? `## Candidate 1\none [${systemPrompt}]\n\n## Candidate 2\ntwo`
    : agent.slug === 'sections' ? '## Pitch\nOriginal pitch.\n\n## Notes\nOriginal notes.'
    : `from ${agent.slug} <<${systemPrompt}>>`
let model: Model = defaultModel
const ran: { slug: string; systemPrompt: string; model: string }[] = []

vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: AgentDef, systemPrompt: string, input: string): Promise<AgentOutput> => {
    ran.push({ slug: agent.slug, systemPrompt, model: agent.model })
    const output = await model(agent, systemPrompt)
    return {
      agentName: agent.name, systemPrompt, input, output,
      tokensIn: 5, tokensOut: 5, costUsd: 0.001, latencyMs: 0, model: agent.model, timestamp: new Date().toISOString(), status: 'success',
    }
  },
}))

function agent(slug: string, systemPrompt: string, dice?: unknown): AgentDef {
  const def: AgentDef = {
    slug, name: slug, model: 'm', description: '', skills: [], context: [], input_from: 'user',
    output_format: 'markdown', outputs: [], inputs: [], systemPrompt, filePath: '',
    ...(dice ? { dice: normalizeDice(dice, slug) } : {}),
  }
  return { ...def, inputs: agentSlots(def).map(name => ({ name })) }
}

const agents = [
  agent('prop', 'propose {input}'),
  agent('decider', 'decide {input}'),
  agent('after', 'build on <<{direction}>>'),
  agent('sections', 'structured {input}'),
  agent('rewriter', 'Story: {story} / Audience: {audience}'),
  agent('designer', 'Design a character for {input}.\n{dice}', { culture: ['Edo Japan', 'Tang China', 'Joseon Korea'], hair: ['short bob', 'twin tails'] }),
]

const HELD = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: prop
    kind: agent
    agent: prop
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: prop.input
  - from: prop
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`
const TWO_HOLDS = HELD
  .replace('edges:\n', '  - id: hold2\n    kind: hold\n  - id: last\n    kind: agent\n    agent: after\nedges:\n')
  .replace(/---\n$/, '  - from: after\n    to: hold2.in\n  - from: hold2\n    to: last.direction\n---\n')
const WAVE_MATES = HELD.replace('edges:\n', '  - id: hold2\n    kind: hold\nedges:\n  - from: dec\n    to: hold2.in\n')
const SIBLINGS = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: prop
    kind: agent
    agent: prop
  - id: other
    kind: agent
    agent: prop
  - id: j
    kind: join
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: prop.input
  - from: seed
    to: other.input
  - from: prop
    to: j.in
  - from: other
    to: j.in
  - from: j
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`
const TWIN_HOLDS = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: other
    kind: decider
    agent: decider
  - id: second
    kind: hold
edges:
  - from: seed
    to: dec.input
  - from: dec
    to: hold.in
  - from: seed
    to: other.input
  - from: other
    to: second.in
---
`
const STRUCTURED = HELD.replace('agent: prop', 'agent: sections')
const PAIR = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: first
    kind: agent
    agent: designer
  - id: second
    kind: agent
    agent: designer
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: first.input
  - from: seed
    to: second.input
  - from: first
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`
const WRITER = `---
name: held
nodes:
  - id: story-seed
    kind: seed
  - id: audience-seed
    kind: seed
  - id: writer
    kind: agent
    agent: rewriter
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: story-seed
    to: writer.story
  - from: audience-seed
    to: writer.audience
  - from: writer
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
inputs:
  - name: story
    node: story-seed
  - name: audience
    node: audience-seed
---
`

let chain: ChainDef
let ws = memoryWorkspace({} as LiveWorkspace)

function useChain(text: string) {
  chain = parseChainContent(text, 'held')
  ws = memoryWorkspace({
    agents, skills: [], chains: [chain], tools: [], templates: [], context: [], defaults: {},
  } as unknown as LiveWorkspace)
}

beforeEach(() => {
  nextId = 0
  model = defaultModel
  ran.length = 0
  useChain(HELD)
})

type Event = { type: string; [k: string]: unknown }

async function events(res: Response): Promise<Event[]> {
  assert.strictEqual(res.status, 200, await res.clone().text())
  const text = await res.text()
  return text.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}

/** A source run of the current chain, streamed to its end. */
async function start(extra: Partial<Parameters<typeof startRun>[1]> = {}): Promise<string> {
  const streamed = await events(startRun(ws, {
    chain, workspace: ws.definitions(), title: chain.name, seedPrompt: 'go',
    versions: { 'chain/held': 1 }, versionNumber: 1, chainSlug: chain.slug, entrypoint: { kind: 'chain', slug: chain.slug },
    ...extra,
  }))
  ran.length = 0
  return streamed[0].runId as string
}

const go = (runId: string, plan: ContinuePlan) => continueRun(ws, runId, plan)
const answer = (runId: string, body: Partial<AnswerRequest>) => go(runId, { answer: { direction: '', ...body } })
const reroll = (runId: string, body: Partial<RerollRequest> = {}) => go(runId, { reroll: { holdId: 'hold', ...body } })
const promote = (runId: string, nodeId: string, turn?: number) => go(runId, { promote: { nodeId, ...(turn ? { turn } : {}) } })
// Addressed revisions take the shape the request reader gives them (#160).
const fork = (runId: string, body: Record<string, unknown>) => {
  const request = readForkRequest(body)
  return 'error' in request ? toResponse(request) : go(runId, { fork: request })
}

const meta = (runId: string): RunMeta => ws.runs.read(runId)
const openHold = (runId: string): HoldRecord => meta(runId).holds!.findLast(h => !h.resolvedAt)!
/** Every log write in order, rewrites included. */
const writes = (runId: string) => ws.runs.logs(runId).map(({ step, output }) => ({ step, nodeId: output.nodeId, output }))
/** The run's log files as the disk adapter would name them. */
const logNames = (runId: string) => [...new Map(ws.runs.logs(runId).map(l => [l.step, stepLog(runId, l.step, l.output).name])).values()].sort()
const logOf = (runId: string, step: number) => {
  const output = ws.runs.logs(runId).findLast(l => l.step === step)!.output
  return matter(stepLog(runId, step, output).content)
}
const runIdOf = (streamed: Event[]) => streamed[0].runId as string
const runIds = () => ws.runs.list().map(m => m.runId).sort()

/** Adds a conversation to a node's latest record, as a node chat would (#97). */
function converse(runId: string, nodeId: string, turns: string[]) {
  const outputs = meta(runId).agentOutputs
  const i = outputs.findLastIndex(o => o.nodeId === nodeId)
  const conversation: ChatMessage[] = turns.flatMap((t, n) => [{ role: 'user', content: t }, { role: 'assistant', content: `revised ${n + 1}`, thought: `why ${n + 1}` }])
  outputs[i] = { ...outputs[i], conversation: [...(outputs[i].conversation ?? []), ...conversation] }
  ws.runs.update(runId, { agentOutputs: outputs })
  const step = ws.runs.latestStepOf(runId, nodeId)!
  ws.runs.writeStep(runId, step, outputs[i])
}

describe('resume', () => {
  test('in place logs the hold and what follows after the last log, and completes', async () => {
    const runId = await start()
    const streamed = await events(answer(runId, { direction: 'KEEP: halo\nKILL: stance' }))

    assert.strictEqual(runIdOf(streamed), runId)
    assert.strictEqual(streamed.at(-1)!.type, 'run_complete')
    assert.deepStrictEqual(ran.map(r => r.slug), ['after'], 'only nodes after the hold execute')
    assert.ok(ran[0].systemPrompt.includes('<<KEEP: halo\nKILL: stance>>'), 'the Direction arrives verbatim')
    assert.deepStrictEqual(logNames(runId), ['00-prop.md', '01-dec.md', '02-hold.md', '03-after.md'])
    assert.strictEqual(logOf(runId, 2).content.trim(), 'KEEP: halo\nKILL: stance')

    const after = meta(runId)
    assert.strictEqual(after.status, 'complete')
    assert.ok(after.completedAt)
    assert.deepStrictEqual(after.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'hold', 'after'])
    assert.deepStrictEqual(after.holds!.map(h => [h.direction, !!h.resolvedAt]), [['KEEP: halo\nKILL: stance', true]])
  })

  test('keeps the version pins and the earlier logs', async () => {
    const runId = await start()
    const before = meta(runId)
    await events(answer(runId, { direction: 'go' }))
    const after = meta(runId)
    assert.deepStrictEqual(after.versions, before.versions)
    assert.strictEqual(after.versionNumber, before.versionNumber)
    assert.deepStrictEqual(writes(runId).map(w => w.step), [0, 1, 2, 3], 'no earlier log is written again')
  })

  test('a chain with two holds pauses twice and resumes twice in one run', async () => {
    useChain(TWO_HOLDS)
    const runId = await start()
    const first = await events(answer(runId, { direction: 'first answer' }))
    assert.deepStrictEqual([first.at(-1)!.type, first.at(-1)!.runId, first.at(-1)!.nodeId], ['run_waiting', runId, 'hold2'])
    assert.deepStrictEqual(meta(runId).holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', true], ['hold2', false]])

    ran.length = 0
    const second = await events(answer(runId, { direction: 'second answer' }))
    assert.strictEqual(second.at(-1)!.type, 'run_complete')
    assert.deepStrictEqual(ran.map(r => r.slug), ['after'])
    assert.ok(ran[0].systemPrompt.includes('<<second answer>>'))
    assert.deepStrictEqual(logNames(runId), ['00-prop.md', '01-dec.md', '02-hold.md', '03-after.md', '04-hold2.md', '05-last.md'])
    assert.deepStrictEqual(meta(runId).holds!.map(h => [h.nodeId, h.direction]), [['hold', 'first answer'], ['hold2', 'second answer']])
  })

  test('resuming one of two wave-mate holds leaves the other open once, not twice', async () => {
    useChain(WAVE_MATES)
    const runId = await start()
    assert.strictEqual(meta(runId).holds!.length, 2)
    const streamed = await events(answer(runId, { holdId: 'hold', direction: 'answer' }))
    assert.strictEqual(streamed.at(-1)!.type, 'run_waiting')
    assert.strictEqual(meta(runId).holds!.length, 2)
    assert.strictEqual(meta(runId).holds!.filter(h => !h.resolvedAt).length, 1)
  })

  test('chosen composes PICK, the candidate body, then the Direction, and records the heading as written (#96)', async () => {
    const runId = await start()
    assert.deepStrictEqual(meta(runId).holds![0].candidates.map(c => c.heading), ['Candidate 1', 'Candidate 2'])
    await events(answer(runId, { chosen: '  candidate   2 ', direction: 'KEEP: halo' }))

    const expected = 'PICK: Candidate 2\ntwo\n\nKEEP: halo'
    assert.ok(ran[0].systemPrompt.includes(`<<${expected}>>`), 'the next node reads the pick first')
    assert.strictEqual(logOf(runId, 2).content.trim(), expected)
    assert.strictEqual(logOf(runId, 2).data.chosen, 'Candidate 2')
    assert.deepStrictEqual([meta(runId).holds![0].chosen, meta(runId).holds![0].direction], ['Candidate 2', 'KEEP: halo'])
  })

  test('custom composes PICK: custom and the human\'s own text; no pick leaves none (#96)', async () => {
    const runId = await start()
    await events(answer(runId, { custom: 'Halo as a pet that grows', direction: 'KEEP: gameplay' }))
    const expected = 'PICK: custom\nHalo as a pet that grows\n\nKEEP: gameplay'
    assert.ok(ran[0].systemPrompt.includes(`<<${expected}>>`))
    assert.strictEqual(logOf(runId, 2).content.trim(), expected)
    assert.deepStrictEqual([meta(runId).holds![0].custom, meta(runId).holds![0].chosen], ['Halo as a pet that grows', undefined])

    // A null chosen reads as none (#96).
    const plain = await start()
    const request = readAnswerRequest({ chosen: null, direction: 'go' })
    assert.ok(!('error' in request))
    await events(go(plain, { answer: request }))
    assert.strictEqual(logOf(plain, 2).data.chosen, undefined)
    assert.strictEqual(meta(plain).holds![0].chosen, undefined)
  })

  test('a pick the hold cannot take is refused and changes nothing (#96)', async () => {
    const runId = await start()
    assert.strictEqual(answer(runId, { chosen: 'Candidate 9', direction: 'x' }).status, 400)
    assert.strictEqual(answer(runId, { chosen: 'Candidate 1', custom: 'mine', direction: 'x' }).status, 400)
    assert.strictEqual(meta(runId).status, 'waiting')
    assert.strictEqual(meta(runId).holds![0].chosen, undefined)
  })

  test('is refused while the run is running, or when it has no hold; an unknown run is not found', async () => {
    const runId = await start()
    ws.runs.update(runId, { status: 'running' })
    assert.strictEqual(answer(runId, { direction: 'go' }).status, 409)
    ws.runs.update(runId, { status: 'complete', holds: [] })
    assert.strictEqual(answer(runId, { direction: 'go' }).status, 409)
    assert.strictEqual(answer('no-such-run', { direction: 'go' }).status, 404)
  })

  test('a run claimed by another stretch after it was read is refused at the claim', async () => {
    const runId = await start()
    const { runs } = ws
    let rival = false
    const racing = { ...ws, runs: { ...runs, read: (id: string) => { const m = runs.read(id); rival = runs.claim(id, {}); return m } } }
    const res = continueRun(racing, runId, { answer: { direction: 'go on' } })
    assert.ok(rival)
    assert.strictEqual(res.status, 409)
    assert.deepStrictEqual(meta(runId).agentOutputs.map(o => o.nodeId), ['prop', 'dec'])
  })

  test('independent picks fork from one waiting hold and run together (#76)', async () => {
    const source = await start()
    const hold = meta(source).holds![0]
    ws.runs.update(source, { holds: [{ ...hold, candidates: [...hold.candidates, { heading: 'Candidate 3', body: 'third route' }] }] })
    const responses = ['Candidate 1', 'Candidate 2', 'Candidate 3'].map(chosen => answer(source, { holdId: 'hold', chosen, direction: 'go', fork: true }))
    const ids = (await Promise.all(responses.map(events))).map(runIdOf)
    assert.strictEqual(new Set([...ids, source]).size, 4)
    assert.strictEqual(meta(source).status, 'waiting')
    assert.strictEqual(meta(source).holds![0].resolvedAt, undefined)
    assert.deepStrictEqual(ids.map(id => meta(id).holds![0].chosen), ['Candidate 1', 'Candidate 2', 'Candidate 3'])
  })

  test('re-answering an answered hold forks with the new answer; the source is untouched', async () => {
    const source = await start()
    await events(answer(source, { chosen: 'Candidate 1', direction: 'first answer' }))
    const before = JSON.stringify(meta(source))
    ran.length = 0

    const streamed = await events(answer(source, { chosen: 'Candidate 2', direction: 'second answer' }))
    const forkId = runIdOf(streamed)
    assert.notStrictEqual(forkId, source)
    assert.strictEqual(streamed.at(-1)!.type, 'run_complete')
    assert.deepStrictEqual(ran.map(r => r.slug), ['after'], 'only what follows the hold runs')
    assert.ok(ran[0].systemPrompt.includes('PICK: Candidate 2\ntwo\n\nsecond answer'))

    const forked = meta(forkId)
    assert.deepStrictEqual([forked.branchedFromRunId, forked.branchedFromNode, forked.status], [source, 'hold', 'complete'])
    assert.deepStrictEqual(forked.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'hold', 'after'])
    assert.deepStrictEqual(forked.holds!.map(h => [h.chosen, h.direction, !!h.resolvedAt]), [['Candidate 2', 'second answer', true]])
    assert.deepStrictEqual(logNames(forkId), ['00-prop.md', '01-dec.md', '02-hold.md', '03-after.md'])
    assert.strictEqual(logOf(forkId, 2).data.chosen, 'Candidate 2')
    assert.strictEqual(JSON.stringify(meta(source)), before)

    const custom = await events(answer(source, { custom: 'mine', direction: 'x' }))
    assert.deepStrictEqual([meta(runIdOf(custom)).holds![0].custom, meta(runIdOf(custom)).holds![0].chosen], ['mine', undefined])
  })

  test('with several holds, a re-answer names the hold; an answered one on a waiting run forks', async () => {
    useChain(TWO_HOLDS)
    const source = await start()
    await events(answer(source, { direction: 'first answer' }))

    const forkId = runIdOf(await events(answer(source, { holdId: 'hold', direction: 'again' })))
    assert.notStrictEqual(forkId, source)
    assert.strictEqual(meta(forkId).branchedFromNode, 'hold')
    assert.deepStrictEqual(meta(forkId).holds!.map(h => [h.nodeId, h.direction ?? null]), [['hold', 'again'], ['hold2', null]])

    await events(answer(source, { direction: 'second answer' }))
    assert.strictEqual(meta(source).status, 'complete')
    assert.strictEqual(answer(source, { direction: 'which?' }).status, 400, 'two answered holds: holdId is required')
    assert.strictEqual(answer(source, { holdId: 'nope', direction: 'x' }).status, 404)
    const again = await events(answer(source, { holdId: 'hold2', direction: 'third' }))
    assert.strictEqual(meta(runIdOf(again)).branchedFromNode, 'hold2')
  })

  test('a fork past an answered hold carries the hold, which can be answered again (#96, #103)', async () => {
    const runId = await start()
    await events(answer(runId, { chosen: 'Candidate 2', direction: 'go' }))
    const forkId = runIdOf(await events(fork(runId, { from: 'after' })))
    assert.strictEqual(logOf(forkId, 2).data.chosen, 'Candidate 2')
    assert.strictEqual(meta(forkId).status, 'complete')
    assert.deepStrictEqual(meta(forkId).holds!.map(h => [h.nodeId, h.chosen, !!h.resolvedAt]), [['hold', 'Candidate 2', true]])
    await events(answer(forkId, { direction: 'again' }))
  })
})

describe('promote', () => {
  test('in place relogs its source flagged and logs the rerun after the last log (#98)', async () => {
    useChain(SIBLINGS)
    const runId = await start()
    const before = meta(runId)
    const logsBefore = logNames(runId)
    converse(runId, 'prop', ['push harder', 'again'])
    const propStep = ws.runs.latestStepOf(runId, 'prop')!

    const streamed = await events(promote(runId, 'prop'))
    assert.deepStrictEqual([streamed.at(-1)!.type, streamed.at(-1)!.runId, streamed.at(-1)!.nodeId], ['run_waiting', runId, 'hold'])
    assert.deepStrictEqual(ran.map(r => r.slug), ['decider'], 'only the nodes between the proposer and the hold run')
    assert.ok(ran[0].systemPrompt.includes('revised 2'), 'the decider reads the promoted reply')
    assert.ok(ran[0].systemPrompt.includes('from prop'), 'a sibling proposer replays its output')

    const logs = logNames(runId)
    assert.deepStrictEqual(logs.slice(0, logsBefore.length), logsBefore, 'earlier logs stay as earlier steps')
    assert.deepStrictEqual(logs.slice(logsBefore.length).map(f => f.replace(/^\d+-/, '')), ['prop.md', 'j.md', 'dec.md'])
    assert.ok(logOf(runId, logsBefore.length).content.trim().endsWith('## Output\n\nrevised 2'))

    const after = meta(runId)
    assert.strictEqual(after.status, 'waiting')
    assert.strictEqual(after.holds!.length, 1, 'the hold record is replaced, not duplicated')
    assert.ok(!after.holds![0].resolvedAt)
    assert.ok(after.holds![0].candidates[0].body.includes('revised 2'), 'candidates reflect the new verdict')
    assert.notStrictEqual(after.holds![0].reachedAt, before.holds![0].reachedAt)
    const ids = after.agentOutputs.map(o => o.nodeId)
    for (const id of ['prop', 'j', 'dec']) assert.strictEqual(ids.filter(x => x === id).length, 2, `${id} keeps its earlier record`)
    assert.deepStrictEqual(ids.slice(-3), ['prop', 'j', 'dec'], 'records follow log order')
    assert.strictEqual(after.agentOutputs.find(o => o.nodeId === 'dec')!.output, before.holds![0].input)

    const flagged = after.agentOutputs.find(o => o.nodeId === 'prop')!
    assert.deepStrictEqual(flagged.conversation!.map(m => m.promoted ?? false), [false, false, false, true])
    assert.match(logOf(runId, propStep).content, /### Turn 2[\s\S]*promoted/)
  })

  test('turn picks an earlier reply; the flag lands on that turn only (#98)', async () => {
    const runId = await start()
    converse(runId, 'prop', ['push harder', 'again'])
    await events(promote(runId, 'prop', 1))
    const after = meta(runId)
    assert.deepStrictEqual(after.agentOutputs.find(o => o.nodeId === 'prop')!.conversation!.map(m => m.promoted ?? false), [false, true, false, false])
    assert.strictEqual(after.agentOutputs.findLast(o => o.nodeId === 'prop')!.output, 'revised 1')
    const log = logOf(runId, 0).content
    assert.match(log, /### Turn 1[\s\S]*promoted[\s\S]*### Turn 2/)
    assert.doesNotMatch(log.split('### Turn 2')[1], /promoted/)
  })

  test('a record kept by a promote is the one on disk: not logged again, not recorded twice', async () => {
    const runId = await start()
    converse(runId, 'dec', ['another?'])
    await events(promote(runId, 'dec'))
    // Step 1 is relogged with its flag; step 2 again for the hold's missing-candidates warning (#37).
    assert.deepStrictEqual(writes(runId).slice(3).map(w => [w.step, w.nodeId]), [[1, 'dec'], [2, 'dec'], [2, 'dec']])
    assert.deepStrictEqual(meta(runId).agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'dec'])
  })

  test('needs a reply to promote, from a proposer in the run, on a run not running', async () => {
    const runId = await start()
    assert.strictEqual(promote(runId, 'prop').status, 400, 'no conversation yet')
    converse(runId, 'prop', ['push'])
    assert.strictEqual(promote(runId, 'prop', 2).status, 400)
    assert.strictEqual(promote(runId, 'hold').status, 400)
    assert.strictEqual(promote(runId, 'nope').status, 404)
    assert.strictEqual(meta(runId).status, 'waiting', 'a refused promote changes nothing')
    assert.ok(!meta(runId).agentOutputs.some(o => o.conversation?.some(m => m.promoted)))
    ws.runs.update(runId, { status: 'running' })
    assert.strictEqual(promote(runId, 'prop').status, 409)
  })

  test('on a finished run it forks at the node; the source changes only by the flag', async () => {
    const source = await start()
    await events(answer(source, { chosen: 'Candidate 1', direction: 'first answer' }))
    converse(source, 'prop', ['push'])
    const before = meta(source)
    const sourceWrites = writes(source).length
    ran.length = 0

    const streamed = await events(promote(source, 'prop'))
    const forkId = runIdOf(streamed)
    assert.notStrictEqual(forkId, source)
    assert.deepStrictEqual([streamed.at(-1)!.type, streamed.at(-1)!.runId], ['run_waiting', forkId], 'the fork reaches the hold again')
    assert.deepStrictEqual(ran.map(r => r.slug), ['decider'], 'only the node\'s descendants run')
    assert.ok(ran[0].systemPrompt.includes('revised 1'))

    const forked = meta(forkId)
    assert.deepStrictEqual([forked.branchedFromRunId, forked.branchedFromNode, forked.status], [source, 'prop', 'waiting'])
    assert.deepStrictEqual(forked.agentOutputs.map(o => o.nodeId), ['prop', 'dec'], 'the revision replaces the node; its descendants are dropped')
    assert.strictEqual(forked.agentOutputs[0].output, 'revised 1')
    assert.ok(forked.agentOutputs[0].priorTranscript?.length, 'the argument travels with the revision')
    assert.deepStrictEqual(forked.holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', false]])
    assert.deepStrictEqual(logNames(forkId), ['00-prop.md', '01-dec.md'])
    assert.deepStrictEqual(forked.graph, before.graph)

    const after = meta(source)
    assert.strictEqual(after.status, 'complete')
    assert.deepStrictEqual(writes(source).slice(sourceWrites).map(w => w.step), [0], 'only the flagged source log is rewritten')
    assert.deepStrictEqual(after.agentOutputs.map(o => o.output), before.agentOutputs.map(o => o.output))
    assert.deepStrictEqual(after.holds, before.holds)
    assert.strictEqual(after.agentOutputs.find(o => o.nodeId === 'prop')!.conversation![1].promoted, true)
  })

  test('a promote that forks keeps the source run\'s model override (#128)', async () => {
    const source = await start({ modelOverride: 'openai/gpt-4o' })
    await events(answer(source, { direction: 'done' }))
    converse(source, 'prop', ['push'])
    ran.length = 0
    const forkId = runIdOf(await events(promote(source, 'prop')))
    assert.strictEqual(meta(forkId).branchedFromRunId, source)
    assert.strictEqual(meta(forkId).modelOverride, 'openai/gpt-4o')
    assert.deepStrictEqual(ran.map(r => r.model), ['openai/gpt-4o'])
  })

  test('past an answered hold on a waiting run it forks; a hold below the node only stays in place', async () => {
    useChain(TWO_HOLDS)
    const source = await start()
    await events(answer(source, { direction: 'first answer' }))
    converse(source, 'after', ['push'])
    converse(source, 'prop', ['push'])

    assert.strictEqual(runIdOf(await events(promote(source, 'after'))), source)
    const forkId = runIdOf(await events(promote(source, 'prop')))
    assert.notStrictEqual(forkId, source)
    assert.strictEqual(meta(forkId).branchedFromNode, 'prop')
    assert.deepStrictEqual(meta(forkId).holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', false]], 'answered holds below the node are asked again')
    assert.strictEqual(meta(source).status, 'waiting', 'the source stays where it was')
  })
})

describe('fork', () => {
  test('logs every replayed record afresh in a new run, from step 0', async () => {
    const source = await start()
    await events(answer(source, { direction: 'done' }))
    const forkId = runIdOf(await events(fork(source, { from: 'dec' })))
    assert.deepStrictEqual(writes(forkId).map(w => [w.step, w.nodeId]), [[0, 'prop'], [1, 'dec']])
    assert.strictEqual(meta(forkId).branchedFromRunId, source)
  })

  test('from a node reruns it and its descendants, keeping answered holds above (#103)', async () => {
    useChain(TWO_HOLDS)
    const source = await start()
    await events(answer(source, { direction: 'first answer' }))
    ran.length = 0
    const streamed = await events(fork(source, { from: 'after' }))
    assert.deepStrictEqual(ran.map(r => r.slug), ['after'])
    assert.strictEqual(streamed.at(-1)!.type, 'run_waiting', 'the hold below the anchor is asked again')
    const forked = meta(runIdOf(streamed))
    assert.deepStrictEqual([forked.branchedFromRunId, forked.branchedFromNode], [source, 'after'])
    assert.deepStrictEqual(forked.holds!.map(h => [h.nodeId, !!h.resolvedAt]), [['hold', true], ['hold2', false]])
  })

  test('with revisions replays the revised text and reruns only what it feeds (#103)', async () => {
    const source = await start()
    await events(answer(source, { direction: 'done' }))
    ran.length = 0
    const forkId = runIdOf(await events(fork(source, { revisions: { prop: 'my own proposal' } })))
    assert.deepStrictEqual(ran.map(r => r.slug), ['decider'])
    assert.ok(ran[0].systemPrompt.includes('my own proposal'))
    const prop = meta(forkId).agentOutputs.find(o => o.nodeId === 'prop')!
    assert.deepStrictEqual([prop.output, prop.tokensIn, meta(forkId).branchedFromNode], ['my own proposal', 0, 'prop'])
  })

  test('addressed revisions splice into the node output, keeping unedited sections (#160)', async () => {
    useChain(STRUCTURED)
    const source = await start()
    await events(answer(source, { direction: 'done' }))
    ran.length = 0
    const forkId = runIdOf(await events(fork(source, { revisions: { prop: { notes: 'Edited notes.' } } })))
    assert.deepStrictEqual(ran.map(r => r.slug), ['decider'], 'only prop descendants rerun')
    assert.ok(ran[0].systemPrompt.includes('Edited notes.'))
    assert.strictEqual(meta(forkId).agentOutputs.find(o => o.nodeId === 'prop')!.output, '## Pitch\nOriginal pitch.\n\n## Notes\nEdited notes.')

    const both = runIdOf(await events(fork(source, { revisions: { prop: {
      pitch: { text: 'Edited pitch.', was: 'Original pitch.' },
      notes: { text: 'Edited notes.', was: 'Original notes.' },
    } } })))
    assert.strictEqual(meta(both).agentOutputs.find(o => o.nodeId === 'prop')!.output, '## Pitch\nEdited pitch.\n\n## Notes\nEdited notes.')

    const whole = runIdOf(await events(fork(source, { revisions: { prop: { output: 'whole replacement' } } })))
    assert.strictEqual(meta(whole).agentOutputs.find(o => o.nodeId === 'prop')!.output, 'whole replacement')

    assert.strictEqual(fork(source, { revisions: { prop: { notes: { text: 'Edited notes.', was: 'Something else' } } } }).status, 409)
    assert.strictEqual(fork(source, { revisions: { prop: { missing: 'Edited' } } }).status, 422)
    assert.strictEqual(fork(source, { revisions: { prop: { notes: 'Edited notes.\n\n## Smuggled\nAttack' } } }).status, 422)
  })

  test('refuses what it cannot read against the run', async () => {
    const source = await start()
    await events(answer(source, { direction: 'done' }))
    assert.strictEqual(fork(source, { from: 'nope' }).status, 404)
    assert.strictEqual(fork(source, { revisions: { hold: 'x' } }).status, 400, 'a hold is answered through resume')
    assert.strictEqual(fork('no-such-run', { from: 'prop' }).status, 404)
    converse(source, 'prop', ['push'])
    ws.runs.update(source, { status: 'running' })
    assert.strictEqual(fork(source, { from: 'prop' }).status, 409)
    assert.strictEqual(answer(source, { direction: 'x' }).status, 409)
    assert.strictEqual(promote(source, 'prop').status, 409)
  })
})

describe('version pins (#169)', () => {
  /** The test agents and chain as loaded files: each with a path and the bytes a version hashes. */
  function useFiles(edit: Record<string, string> = {}) {
    const raw = (slug: string, body: string) => edit[slug] ?? `---\nname: ${slug}\nmodel: m\n---\n${body}\n`
    const defs = {
      agents: [
        ...agents.map(a => ({ ...a, filePath: `agents/${a.slug}.md`, rawContent: raw(a.slug, a.systemPrompt) })),
        { ...agent('prop-bold', 'boldly propose {input}'), variantOf: 'prop', filePath: 'agents/prop.md', rawContent: raw('prop', 'propose {input}') },
      ],
      skills: [], tools: [], templates: [], context: [], defaults: {},
      chains: [{ ...chain, filePath: 'chains/held.md', rawContent: edit.held ?? HELD }],
    } as unknown as LiveWorkspace
    ws = { ...ws, definitions: () => defs }
  }
  async function launch(body: RunRequestBody): Promise<string> {
    const prepared = prepareRunRequest(ws, { seedPrompt: 'go', ...body })
    assert.ok(!('error' in prepared))
    const streamed = await events(startRun(ws, prepared.input))
    ran.length = 0
    return runIdOf(streamed)
  }
  const stamps = (runId: string) => writes(runId).map(w => w.output.versionNumber)

  test('a fork of an agent run keeps the agent\'s version number', async () => {
    useFiles()
    const source = await launch({ agentName: 'prop' })
    assert.strictEqual(meta(source).versionNumber, 1)

    const forkId = runIdOf(await events(fork(source, { from: 'prop' })))
    assert.strictEqual(meta(forkId).versionNumber, 1)
    assert.deepStrictEqual(stamps(forkId), [1])

    useFiles({ prop: '---\nname: prop\nmodel: m\n---\nedited {input}\n' })
    const current = runIdOf(await events(fork(source, { from: 'prop' })))
    const pinned = runIdOf(await events(fork(source, { from: 'prop', versions: 'pinned' })))
    assert.deepStrictEqual([meta(current).versionNumber, meta(current).versions!['agent/prop']], [2, 2])
    assert.deepStrictEqual([meta(pinned).versionNumber, meta(pinned).versions!['agent/prop']], [1, 1])
  })

  test('a variant agent run is numbered by its declaring file (ADR-0013)', async () => {
    useFiles()
    const source = await launch({ agentName: 'prop-bold' })
    assert.strictEqual(meta(source).versionNumber, 1)
    const forkId = runIdOf(await events(fork(source, { from: 'prop-bold' })))
    assert.deepStrictEqual(stamps(forkId), [1])
  })

  test('in place, an agent run keeps the agent\'s version number', async () => {
    useFiles()
    const source = await launch({ agentName: 'prop' })
    converse(source, 'prop', ['push'])
    ws.runs.update(source, { status: 'waiting' })
    const before = stamps(source).length
    const streamed = await events(promote(source, 'prop'))
    assert.strictEqual(runIdOf(streamed), source, 'promoted in place')
    const promoted = stamps(source).slice(before)
    assert.ok(promoted.length > 0)
    assert.deepStrictEqual(promoted, promoted.map(() => 1))
  })

  test('in place snapshots only the file it stamps, and keeps the run\'s pins', async () => {
    useFiles()
    const source = await launch({ chainName: 'held' })
    const pins = meta(source).versions
    assert.strictEqual(pins!['chain/held'], 1)

    useFiles({ held: `${HELD}\n`, after: '---\nname: after\nmodel: m\n---\nedited <<{direction}>>\n' })
    await events(answer(source, { direction: 'go' }))
    assert.deepStrictEqual(meta(source).versions, pins)
    assert.deepStrictEqual(stamps(source), [1, 1, 2, 2], 'the resumed logs carry the chain version they ran')
    assert.strictEqual(ws.versions.list('agent', 'after').length, 1, 'a file the run does not record is not snapshotted')
  })
})

describe('reroll', () => {
  let deciderCalls = 0
  let deciderFails: 'throw' | 'malformed' | undefined
  let gate: Promise<void> | undefined
  const numbered: Model = async (a, systemPrompt) => {
    if (a.slug !== 'decider') return defaultModel(a, systemPrompt)
    deciderCalls++
    if (gate) { await gate; return '## Candidate 1\nlate' }
    if (deciderFails === 'throw') throw new Error('provider down')
    if (deciderFails === 'malformed') return 'no sections at all'
    return `## Candidate 1\nset ${deciderCalls} one\n\n## Candidate 2\nset ${deciderCalls} two`
  }
  const deciderPrompts = () => ran.filter(r => r.slug === 'decider').map(r => r.systemPrompt)

  beforeEach(() => {
    deciderCalls = 0
    deciderFails = undefined
    gate = undefined
    model = numbered
  })

  test('in place twice with saved feedback, then resume with a pick from the second set (#134)', async () => {
    const runId = await start()
    assert.strictEqual(openHold(runId).revision, 1)
    const saved = saveFeedback(ws, runId, 'hold', { feedback: 'Less tragic, but keep a real consequence' })
    assert.strictEqual((await saved.json()).hold.feedback, 'Less tragic, but keep a real consequence')

    const first = await events(reroll(runId, { revision: 1 }))
    const waiting = first.at(-1)!
    assert.strictEqual(waiting.type, 'run_waiting')
    assert.strictEqual((waiting.hold as HoldRecord).revision, 2)
    assert.deepStrictEqual((waiting.hold as HoldRecord).candidates.map(c => c.body), ['set 2 one', 'set 2 two'])
    assert.strictEqual((await events(reroll(runId, { revision: 2 }))).at(-1)!.type, 'run_waiting')

    assert.deepStrictEqual(ran.map(r => r.slug), ['decider', 'decider'], 'only the producer reruns')
    for (const prompt of deciderPrompts()) {
      assert.strictEqual(prompt.split('Less tragic, but keep a real consequence').length, 2, 'feedback is added once')
      assert.ok(prompt.startsWith('decide from prop'))
    }
    const after = meta(runId)
    assert.strictEqual(after.status, 'waiting')
    assert.deepStrictEqual([openHold(runId).revision, openHold(runId).feedback], [3, 'Less tragic, but keep a real consequence'])
    assert.deepStrictEqual(openHold(runId).candidates.map(c => c.body), ['set 3 one', 'set 3 two'])
    assert.deepStrictEqual(after.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'dec', 'dec'])
    assert.deepStrictEqual(logNames(runId), ['00-prop.md', '01-dec.md', '02-dec.md', '03-dec.md'])
    assert.ok(logOf(runId, 1).content.includes('set 1 one'))
    assert.strictEqual(logOf(runId, 3).data.reroll_feedback, 'Less tragic, but keep a real consequence')
    assert.deepStrictEqual(writes(runId).map(w => w.step), [0, 1, 2, 3], 'upstream logs are untouched')

    const resumed = await events(answer(runId, { chosen: 'Candidate 2', revision: 3 }))
    assert.strictEqual(resumed.at(-1)!.type, 'run_complete')
    assert.ok(ran.at(-1)!.systemPrompt.includes('PICK: Candidate 2\nset 3 two'))
  })

  test('feedback: omitted keeps the saved value, empty clears it, and it reaches only the reroll prompt', async () => {
    const runId = await start()
    await events(reroll(runId, { feedback: 'darker' }))
    assert.strictEqual(openHold(runId).feedback, 'darker')
    await events(reroll(runId))
    await events(reroll(runId, { feedback: '' }))
    assert.strictEqual(openHold(runId).feedback, undefined)
    assert.deepStrictEqual(deciderPrompts().map(p => p.includes('darker')), [true, true, false])
    assert.strictEqual(deciderPrompts()[2], 'decide from prop <<propose go>>')

    await events(answer(runId, { direction: 'go on' }))
    assert.ok(!ran.at(-1)!.systemPrompt.includes('darker'))
  })

  test('a failed attempt keeps the old candidates and feedback, records and costs the attempt, and leaves the run waiting', async () => {
    const runId = await start()
    const before = openHold(runId)
    for (const failure of ['throw', 'malformed'] as const) {
      deciderFails = failure
      const streamed = await events(reroll(runId, { feedback: 'kinder', revision: 1 }))
      assert.ok(streamed.some(e => e.type === 'reroll_failed'), failure)
      assert.strictEqual(streamed.at(-1)!.type, 'run_waiting')
      assert.deepStrictEqual([openHold(runId).candidates, openHold(runId).revision, openHold(runId).feedback], [before.candidates, 1, 'kinder'])
    }
    const outputs = meta(runId).agentOutputs
    assert.strictEqual(meta(runId).status, 'waiting')
    assert.strictEqual(outputs.at(-1)!.status, 'success', 'the decider still reads as its usable output')
    const attempt = outputs.at(-2)!
    assert.deepStrictEqual([attempt.status, attempt.reroll], ['error', { holdId: 'hold', feedback: 'kinder' }])
    assert.ok((attempt.costUsd ?? 0) > 0, 'the malformed answer still spent, and is counted')

    deciderFails = undefined
    await events(answer(runId, { chosen: 'Candidate 1', revision: 1 }))
    assert.strictEqual(meta(runId).status, 'complete')
  })

  test('stale revisions are conflicts; a legacy pick is refused only once a reroll replaced the set', async () => {
    const runId = await start()
    assert.strictEqual(reroll(runId, { revision: 2 }).status, 409)
    await events(reroll(runId, { revision: 1 }))
    assert.strictEqual(answer(runId, { chosen: 'Candidate 2', revision: 1 }).status, 409)
    assert.strictEqual(answer(runId, { chosen: 'Candidate 2' }).status, 409)
    assert.strictEqual(reroll(runId, { revision: 1 }).status, 409)
    assert.strictEqual((await events(answer(runId, { custom: 'my own' }))).at(-1)!.type, 'run_complete')
  })

  test('with two open holds, a reroll touches only the named one', async () => {
    useChain(TWIN_HOLDS)
    const runId = await start()
    const second = () => meta(runId).holds!.find(h => h.nodeId === 'second')!
    const before = second()
    await events(reroll(runId, { feedback: 'darker' }))
    assert.strictEqual(openHold(runId).nodeId, 'second')
    assert.strictEqual(meta(runId).holds!.find(h => h.nodeId === 'hold')!.revision, 2)
    assert.deepStrictEqual(second(), before)
  })

  test('in flight it claims the run: a second continuation is refused', async () => {
    const runId = await start()
    let release = () => {}
    gate = new Promise(resolve => { release = resolve })
    const inFlight = events(reroll(runId))
    assert.strictEqual(meta(runId).status, 'running')
    assert.strictEqual(reroll(runId).status, 409)
    assert.strictEqual(answer(runId, { direction: 'go' }).status, 409)
    assert.strictEqual(saveFeedback(ws, runId, 'hold', { feedback: 'x' }).status, 409)
    release()
    await inFlight
    assert.strictEqual(meta(runId).status, 'waiting')
  })

  test('an answered hold forks: the source keeps its answer, the fork waits on a fresh set (#147)', async () => {
    const runId = await start()
    await events(answer(runId, { chosen: 'Candidate 1', revision: 1 }))
    const source = JSON.stringify(meta(runId))
    const sourceWrites = writes(runId).length
    ran.length = 0

    const streamed = await events(reroll(runId, { feedback: 'darker', revision: 1 }))
    const forkId = runIdOf(streamed)
    assert.notStrictEqual(forkId, runId)
    const waiting = streamed.at(-1)!
    assert.deepStrictEqual([waiting.type, waiting.runId], ['run_waiting', forkId])
    const hold = waiting.hold as HoldRecord
    assert.deepStrictEqual([hold.revision, hold.resolvedAt, hold.chosen, hold.feedback], [2, undefined, undefined, 'darker'])
    assert.deepStrictEqual(hold.candidates.map(c => c.body), ['set 2 one', 'set 2 two'])

    assert.deepStrictEqual(ran.map(r => r.slug), ['decider'])
    assert.ok(deciderPrompts()[0].includes('darker'))
    assert.strictEqual(JSON.stringify(meta(runId)), source)
    assert.strictEqual(writes(runId).length, sourceWrites)

    const forked = meta(forkId)
    assert.deepStrictEqual([forked.status, forked.branchedFromRunId, forked.branchedFromNode], ['waiting', runId, 'hold'])
    assert.deepStrictEqual(forked.agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'dec'])
    assert.deepStrictEqual(logNames(forkId), ['00-prop.md', '01-dec.md', '02-dec.md'])
    assert.deepStrictEqual(openHold(forkId), hold)

    const resumed = await events(answer(forkId, { chosen: 'Candidate 2', revision: 2 }))
    assert.strictEqual(resumed.at(-1)!.type, 'run_complete')
    assert.ok(ran.at(-1)!.systemPrompt.includes('PICK: Candidate 2\nset 2 two'))
  })

  test('a fork logs its replay as every fork does, then the attempt at the next step', async () => {
    const runId = await start()
    // Two rounds of one node share a fork's log, so outputs outnumber step logs.
    const [prop, dec] = meta(runId).agentOutputs
    ws.runs.update(runId, { agentOutputs: [{ ...prop, output: 'round 0', round: 0 }, { ...prop, output: 'round 1', round: 1 }, dec] })
    const forkId = runIdOf(await events(reroll(runId, { fork: true })))
    assert.deepStrictEqual(writes(forkId).map(w => [w.step, w.nodeId, w.output.output]), [
      [0, 'prop', 'round 0'],
      [0, 'prop', 'round 1'],
      [1, 'dec', dec.output],
      [2, 'dec', '## Candidate 1\nset 2 one\n\n## Candidate 2\nset 2 two'],
    ])
    assert.deepStrictEqual(meta(forkId).agentOutputs.map(o => o.output.slice(0, 7)), ['round 0', 'round 1', dec.output.slice(0, 7), '## Cand'])
  })

  test('`like` forks from an open hold, asks for more like that candidate, and the fork keeps it through later rerolls (#147)', async () => {
    const runId = await start()
    const source = JSON.stringify(meta(runId))
    const forkId = runIdOf(await events(reroll(runId, { like: 'candidate 1', revision: 1 })))
    assert.notStrictEqual(forkId, runId)
    assert.strictEqual(JSON.stringify(meta(runId)), source)
    const like = { candidate: { heading: 'Candidate 1', body: 'set 1 one' }, revision: 1 }
    assert.deepStrictEqual(openHold(forkId).like, like)
    assert.ok(deciderPrompts()[0].includes('set 1 one'))
    assert.ok(deciderPrompts()[0].startsWith('decide from prop'))

    await events(reroll(forkId, { revision: 2 }))
    assert.strictEqual(deciderPrompts()[1].split('set 1 one').length, 2, 'in place inside the fork: the same candidate, once')
    assert.deepStrictEqual([openHold(forkId).revision, openHold(forkId).like], [3, like])
    assert.deepStrictEqual(meta(forkId).agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'dec', 'dec'])

    assert.strictEqual(reroll(runId, { like: 'Candidate 9' }).status, 400)
    assert.strictEqual(reroll(runId, { fork: true, revision: 2 }).status, 409)
  })

  test('a failed fork attempt leaves no run behind and the source untouched (#147)', async () => {
    const runId = await start()
    const source = JSON.stringify(meta(runId))
    for (const failure of ['throw', 'malformed'] as const) {
      deciderFails = failure
      const streamed = await events(reroll(runId, { fork: true }))
      assert.strictEqual(streamed.at(-1)!.type, 'reroll_failed', failure)
      assert.ok(!streamed.some(e => e.type === 'run_waiting'))
      assert.deepStrictEqual(runIds(), [runId])
      assert.strictEqual(JSON.stringify(meta(runId)), source)
    }
  })

  test('a fork does not wait for the source to finish running (#147)', async () => {
    const runId = await start()
    let release = () => {}
    const afterGate = new Promise<void>(resolve => { release = resolve })
    model = async (a, systemPrompt) => (a.slug === 'after' ? (await afterGate, 'from after') : numbered(a, systemPrompt))
    const inFlight = events(answer(runId, { chosen: 'Candidate 2', revision: 1 }))
    assert.strictEqual(meta(runId).status, 'running')

    const streamed = await events(reroll(runId, { like: 'Candidate 1', revision: 1 }))
    assert.strictEqual(streamed.at(-1)!.type, 'run_waiting')
    assert.deepStrictEqual(meta(runIdOf(streamed)).agentOutputs.map(o => o.nodeId), ['prop', 'dec', 'dec'])
    release()
    await inFlight
    assert.deepStrictEqual([meta(runId).status, meta(runId).holds![0].chosen], ['complete', 'Candidate 2'])
  })

  test('a fork of a hold rerolled in place starts from the original record and takes only the request feedback (#147)', async () => {
    const runId = await start()
    await events(reroll(runId, { feedback: 'darker', revision: 1 }))
    ran.length = 0
    assert.strictEqual(reroll(runId, { like: 'Candidate 1' }).status, 409, '`Candidate 1` now means set 2\'s')
    const forkId = runIdOf(await events(reroll(runId, { like: 'Candidate 1', revision: 2 })))
    assert.ok(deciderPrompts()[0].includes('set 2 one'))
    assert.ok(!deciderPrompts()[0].includes('darker'))

    const hold = openHold(forkId)
    assert.deepStrictEqual([hold.feedback, hold.revision, hold.like], [undefined, 3, { candidate: { heading: 'Candidate 1', body: 'set 2 one' }, revision: 2 }])
    const outputs = meta(forkId).agentOutputs
    assert.deepStrictEqual(outputs.map(o => o.nodeId), ['prop', 'dec', 'dec'])
    assert.strictEqual(outputs[1].reroll, undefined)
    assert.ok(outputs[1].output.includes('set 1 one'))
    assert.strictEqual(openHold(runId).revision, 2)
  })
})

describe('pinned dice and named inputs (#153, #152)', () => {
  test('in place, a stretch keeps the run\'s rolls and inputs, and run_start carries the rolls', async () => {
    useChain(PAIR)
    const runId = await start()
    const { dice } = meta(runId)
    assert.deepStrictEqual(Object.keys(dice ?? {}).sort(), ['first', 'second'])

    converse(runId, 'first', ['again'])
    const promoted = await events(promote(runId, 'first'))
    assert.deepStrictEqual(promoted[0].dice, dice)
    assert.deepStrictEqual(meta(runId).dice, dice)
    const answered = await events(answer(runId, { direction: 'go' }))
    assert.deepStrictEqual(answered[0].dice, dice)
    assert.deepStrictEqual(meta(runId).dice, dice)

    model = defaultModel
    await events(reroll(runId))
    assert.deepStrictEqual(meta(runId).dice, dice)
  })

  test('a fork keeps the pinned roll of every node, replayed or rerun', async () => {
    useChain(PAIR)
    const source = await start()
    await events(answer(source, { direction: 'done' }))
    const sourceMeta = meta(source)
    for (const from of ['second', 'seed']) {
      const forked = await events(fork(source, { from }))
      assert.deepStrictEqual(meta(runIdOf(forked)).dice, sourceMeta.dice, `fork from ${from}`)
      assert.deepStrictEqual(forked[0].dice, sourceMeta.dice)
      assert.strictEqual(meta(runIdOf(forked)).agentOutputs.find(o => o.nodeId === 'second')!.output,
        sourceMeta.agentOutputs.find(o => o.nodeId === 'second')!.output)
    }
    const rerolled = await events(reroll(source, { fork: true }))
    assert.deepStrictEqual(rerolled[0].dice, sourceMeta.dice)
    assert.deepStrictEqual(meta(runIdOf(rerolled)).dice, sourceMeta.dice)
  })

  test('the inputs are pinned with the run: every continuation replays the same values', async () => {
    useChain(WRITER)
    const source = await start({ inputs: { story: 'a knight', audience: 'kids' } })
    const story = 'Story: a knight / Audience: kids'
    assert.ok(meta(source).agentOutputs.find(o => o.nodeId === 'writer')!.output.includes(story))

    const reseeded = runIdOf(await events(fork(source, { from: 'story-seed' })))
    assert.ok(meta(reseeded).agentOutputs.find(o => o.nodeId === 'writer')!.output.includes(story), 'a rerun seed reads its pinned input, not seedPrompt')
    assert.deepStrictEqual(meta(reseeded).inputs, { story: 'a knight', audience: 'kids' })

    converse(source, 'writer', ['again'])
    await events(promote(source, 'writer'))
    assert.deepStrictEqual(meta(source).inputs, { story: 'a knight', audience: 'kids' })
    const rerolled = runIdOf(await events(reroll(source, { fork: true })))
    assert.deepStrictEqual(meta(rerolled).inputs, { story: 'a knight', audience: 'kids' })
  })
})
