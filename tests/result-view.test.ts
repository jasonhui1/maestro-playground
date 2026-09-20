import { test } from 'vitest'
import assert from 'node:assert'
import {
  applyResultEvent,
  projectResultView,
  resultViewFromMeta,
  settleResultView,
  startResultView,
  type ResultViewState,
} from '../lib/resultView'
import type { AgentOutput, ChainDef, RunMeta } from '../lib/types'
import type { RunEvent } from '../lib/runStream'
import type { LayoutModel } from '../lib/layoutModel'

function chain(over: Partial<ChainDef> = {}): ChainDef {
  return {
    slug: 'relay', name: 'telephone-relay', description: 'three restatements',
    nodes: [], edges: [], filePath: '',
    view: 'timeline',
    outputs: [{ name: 'draft', node: 'a' }, { name: 'polish', node: 'b' }],
    ...over,
  }
}

function output(nodeId: string, text: string, over: Partial<AgentOutput> = {}): AgentOutput {
  return {
    nodeId, agentName: nodeId, systemPrompt: '', input: '', output: text,
    tokensIn: 1, tokensOut: 2, costUsd: 0.25, latencyMs: 10, model: 'm',
    timestamp: '', status: 'success', ...over,
  }
}

function ran(o: AgentOutput, step: number): RunEvent[] {
  const nodeId = o.nodeId as string
  return [
    { type: 'agent_start', nodeId, agentName: o.agentName, step },
    { type: 'agent_done', nodeId, agentName: o.agentName, step, output: o },
  ]
}

function fold(state: ResultViewState, events: RunEvent[]): ResultViewState {
  return events.reduce(applyResultEvent, state)
}

const STARTED = 1000
const ENDED = 4000
const NOW = 9999

const paste = { kind: 'paste' } as const

function launched(c: ChainDef, paramValue = ''): ResultViewState {
  return startResultView({ chain: c, seed: paste, startedAt: STARTED, paramValue })
}

function metaFor(outputs: AgentOutput[], over: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: 'r1', chainName: 'telephone-relay', seedPrompt: 'a seed',
    startedAt: new Date(STARTED).toISOString(), completedAt: new Date(ENDED).toISOString(),
    status: 'complete', agentOutputs: outputs, ...over,
  }
}

test('one recorded run reaches the same model and frame down either adapter', () => {
  const a = output('a', 'first draft')
  const b = output('b', 'polished')
  const c = chain()

  const streamed = settleResultView(
    fold(launched(c), [
      { type: 'run_start', runId: 'r1' },
      ...ran(a, 1),
      ...ran(b, 2),
      { type: 'run_complete', runId: 'r1' },
    ]),
    ENDED,
  )
  const fromDisk = resultViewFromMeta(metaFor([a, b]), c)

  const live = projectResultView(streamed, NOW)
  const past = projectResultView(fromDisk, NOW)

  assert.deepStrictEqual(live.model, past.model)
  // The seed is the one field that cannot agree: a log never recorded which of paste
  // or file the run was launched from (#72).
  assert.deepStrictEqual({ ...live.frame, seedSource: '' }, { ...past.frame, seedSource: '' })
  assert.strictEqual(live.frame?.status, 'done')
  assert.strictEqual(live.frame?.elapsedMs, ENDED - STARTED)
  assert.strictEqual(live.model?.panels.map(p => p.text).join('|'), 'first draft|polished')
})

test('the streamed projection wins; the local build is the fallback (ADR-0017)', () => {
  const start = launched(chain())
  const engine: LayoutModel = {
    kind: 'timeline',
    panels: [{ name: 'draft', node: 'a', text: 'from the engine', lines: 1, state: 'filled' }],
  }

  const local = fold(start, ran(output('a', 'built here'), 1))
  assert.strictEqual(projectResultView(local, NOW).model?.panels[0].text, 'built here')

  const streamed = fold(local, [{ type: 'layout', model: engine }])
  assert.strictEqual(projectResultView(streamed, NOW).model?.panels[0].text, 'from the engine')
})

test('the fallback build reads outputs as a list, so a sidebar keeps its rounds', () => {
  const c = chain({ view: 'sidebar', outputs: [{ name: 'attempt', node: 'a' }] })
  const state = fold(launched(c), [
    ...ran(output('a', 'round one', { round: 0 }), 1),
    ...ran(output('a', 'round two', { round: 1 }), 2),
  ])
  assert.deepStrictEqual(
    projectResultView(state, NOW).model?.panels.map(p => p.text),
    ['round one', 'round two'],
  )
})

test('starting a run clears the one before it in a single step', () => {
  const c = chain()
  const finished = settleResultView(
    fold(launched(c), [
      ...ran(output('a', 'stale'), 1),
      { type: 'layout', model: { kind: 'timeline', panels: [] } },
      { type: 'run_complete', runId: 'r1' },
      { type: 'error', error: 'it broke' },
    ]),
    ENDED,
  )
  assert.notStrictEqual(projectResultView(finished, NOW).frame?.status, 'running')

  const next = startResultView({ chain: c, seed: paste, startedAt: 5000, paramValue: '' })
  assert.deepStrictEqual(next.outputs, [])
  assert.deepStrictEqual(next.states, {})
  assert.deepStrictEqual(next.order, [])
  assert.strictEqual(next.streamedModel, null)
  assert.strictEqual(next.runId, null)
  assert.strictEqual(next.error, null)
  assert.strictEqual(next.endedAt, undefined)
  // Nothing of the finished run may render against the one just started.
  const view = projectResultView(next, NOW)
  assert.deepStrictEqual(view.model?.panels.map(p => p.state), ['pending', 'pending'])
  assert.strictEqual(view.frame?.status, 'running')
})

test('a request that never streamed reports as the run failing', () => {
  const state = settleResultView(fold(launched(chain()), [{ type: 'error', error: 'Chain not found' }]), ENDED)
  const { frame } = projectResultView(state, NOW)
  assert.strictEqual(frame?.status, 'failed')
  assert.strictEqual(frame?.error, 'Chain not found')
})

test('a failed run read from disk says so without a node having reported it', () => {
  const state = resultViewFromMeta(metaFor([], { status: 'error' }), chain())
  const { frame } = projectResultView(state, NOW)
  assert.strictEqual(frame?.status, 'failed')
  assert.match(frame?.error ?? '', /see the full log/)
})

test('the parameter reaches the frame from the chain live and from the log afterwards', () => {
  const c = chain({ parameter: { name: 'tone', options: ['warm'], node: 'p' } })
  assert.deepStrictEqual(
    projectResultView(launched(c, 'warm'), NOW).frame?.parameter,
    { name: 'tone', value: 'warm' },
  )
  assert.deepStrictEqual(
    projectResultView(resultViewFromMeta(metaFor([], { parameter: { name: 'tone', value: 'warm' } }), c), NOW).frame?.parameter,
    { name: 'tone', value: 'warm' },
  )
})

test('no chain yet means nothing to render, not an empty run', () => {
  const { model, frame, renderable } = projectResultView(
    resultViewFromMeta(metaFor([output('a', 'x')]), undefined),
    NOW,
  )
  assert.strictEqual(model, null)
  assert.strictEqual(frame, null)
  assert.strictEqual(renderable, false)
})

test('a layout whose ports never filled is not renderable (#72)', () => {
  assert.strictEqual(
    projectResultView(resultViewFromMeta(metaFor([output('gone', 'x')]), chain()), NOW).renderable,
    false,
  )
  assert.strictEqual(
    projectResultView(resultViewFromMeta(metaFor([output('a', 'x')]), chain()), NOW).renderable,
    true,
  )
})

test('the run id arrives from the stream, whether the run finished or stopped at a hold', () => {
  const start = launched(chain())
  assert.strictEqual(fold(start, [{ type: 'run_complete', runId: 'r1' }]).runId, 'r1')
  const hold = { nodeId: 'a', input: '', candidates: [], reachedAt: '' }
  assert.strictEqual(fold(start, [{ type: 'run_waiting', runId: 'r2', nodeId: 'a', hold }]).runId, 'r2')
})

test('the trace order and the node states come off the same fold', () => {
  const c = chain()
  const state = fold(launched(c), [...ran(output('a', 'x'), 1), ...ran(output('b', 'y'), 2)])
  assert.deepStrictEqual(state.order, ['a', 'b'])
  assert.strictEqual(state.states.a.status, 'success')
  assert.deepStrictEqual(
    resultViewFromMeta(metaFor([output('a', 'x'), output('b', 'y')]), c).order,
    ['a', 'b'],
  )
})
