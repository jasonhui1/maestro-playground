import type { AgentOutput, ChainDef, RunMeta } from './types'
import { endedRunId, RunEvent } from './runStream'
import { applyRunEvent, RunStateMap } from './runState'
import { applyOrder } from './runModel'
import { buildLayoutModel, isRenderableLayout, LayoutModel } from './layoutModel'
import { buildRunFrame, RunFrameModel, SeedSource } from './runFrame'
import { buildRunStateMap, runOrderOf } from './runHistoryState'

/**
 * The one composition behind both result surfaces (#106): the live page folds a run
 * stream into it, the history page folds a `RunMeta` read from disk. Everything a
 * result view renders is derived here, so the two cannot drift.
 *
 * Pure — no React, no DOM. `hooks/useResultView.ts` is the thin adapter over it.
 */

/** The run a result view is about, however it was reached. */
export interface ResultRun {
  chain: ChainDef
  seed: SeedSource
  startedAt: number
  /** The chain's declared dropdown and what this run set it to (#65). */
  parameter?: { name: string; value: string }
}

export interface ResultViewState {
  /** Null before the first run starts, and while a reopened run's chain is still
   *  being fetched — there is nothing to project onto until it lands. */
  run: ResultRun | null
  states: RunStateMap
  /** Execution order, which `states` cannot recover: it keys by node (#33). */
  order: string[]
  /** Outputs in arrival order — what `buildLayoutModel` reads. Held as a list rather
   *  than flattened back out of `states`, which keys by node and so can only ever show
   *  a loop round's last write (ADR-0017). */
  outputs: AgentOutput[]
  /** The engine's own projection, preferred over the local build. Null until the first
   *  frame, and for a run that never streamed one (ADR-0017). */
  streamedModel: LayoutModel | null
  runId: string | null
  error: string | null
  /** Absent while the run is still live. */
  endedAt?: number
}

/** Nothing has been run yet. */
export const idleResultView: ResultViewState = {
  run: null, states: {}, order: [], outputs: [], streamedModel: null, runId: null, error: null,
}

/**
 * The state a new run starts from. One value rather than a sequence of resets, so no
 * ordering between them exists to get wrong and no piece of the previous run can
 * render against this one (#106).
 */
export function startResultView(input: {
  chain: ChainDef
  seed: SeedSource
  startedAt: number
  paramValue: string
}): ResultViewState {
  const { chain, seed, startedAt, paramValue } = input
  return {
    ...idleResultView,
    run: {
      chain,
      seed,
      startedAt,
      ...(chain.parameter && paramValue
        ? { parameter: { name: chain.parameter.name, value: paramValue } }
        : {}),
    },
  }
}

export function applyResultEvent(state: ResultViewState, e: RunEvent): ResultViewState {
  if (e.type === 'layout') return { ...state, streamedModel: e.model }
  if (e.type === 'error') return { ...state, error: e.error }

  const ended = endedRunId(e)
  if (ended) return { ...state, runId: ended }

  return {
    ...state,
    states: applyRunEvent(state.states, e),
    order: applyOrder(state.order, e),
    outputs: e.type === 'agent_done' ? [...state.outputs, e.output] : state.outputs,
  }
}

/** The run has settled, however its stream closed — that is what ends the clock. */
export function settleResultView(state: ResultViewState, endedAt: number): ResultViewState {
  return { ...state, endedAt }
}

/**
 * The same state, reached from a run on disk. `chain` is the chain the run's name
 * resolves to *now* (#72); it is undefined while the workspace is still loading.
 *
 * No `streamedModel`: a reopened run never streamed one, so it renders through the
 * local build — the fallback ADR-0017 keeps.
 */
export function resultViewFromMeta(meta: RunMeta, chain: ChainDef | undefined): ResultViewState {
  return {
    run: chain
      ? {
          chain,
          // A log never recorded whether its seed was pasted or picked (#72).
          seed: { kind: 'log' },
          startedAt: new Date(meta.startedAt).getTime(),
          ...(meta.parameter ? { parameter: meta.parameter } : {}),
        }
      : null,
    states: buildRunStateMap(meta.agentOutputs),
    order: runOrderOf(meta.agentOutputs),
    outputs: meta.agentOutputs,
    streamedModel: null,
    // The history page is already the run's own page; there is nowhere for it to link.
    runId: null,
    error: meta.status === 'error' ? 'this run failed — see the full log' : null,
    // A reopened run has settled whatever its log says; without an end it would read
    // as still running forever.
    endedAt: new Date(meta.completedAt ?? meta.startedAt).getTime(),
  }
}

export interface ResultView {
  model: LayoutModel | null
  frame: RunFrameModel | null
  /** True once the run's outputs actually landed in a declared layout — what decides
   *  whether the result view is offered at all (#72). */
  renderable: boolean
}

/** Everything the result surfaces render, derived from the state and the clock. */
export function projectResultView(state: ResultViewState, now: number): ResultView {
  const { run } = state
  if (!run) return { model: null, frame: null, renderable: false }

  const model = state.streamedModel ?? buildLayoutModel(run.chain, state.outputs)
  const frame = buildRunFrame({
    chain: run.chain,
    seed: run.seed,
    states: state.states,
    startedAt: run.startedAt,
    endedAt: state.endedAt,
    now,
    parameter: run.parameter,
    requestError: state.error ?? undefined,
  })
  return { model, frame, renderable: isRenderableLayout(model) }
}
