'use client'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { ChainDef, RunMeta } from '@/lib/types'
import type { RunEvent } from '@/lib/runStream'
import type { SeedSource } from '@/lib/runFrame'
import type { RunStateMap } from '@/lib/runState'
import type { PanelDeck } from '@/lib/panelDeck'
import type { PanelFit } from '@/lib/panelFit'
import { usePanelDeck } from './usePanelDeck'
import { usePanelFit } from './usePanelFit'
import {
  applyResultEvent,
  idleResultView,
  projectResultView,
  resultViewFromMeta,
  settleResultView,
  startResultView,
  type ResultView,
  type ResultViewState,
} from '@/lib/resultView'

/** A run read back from its log, and the chain its name resolves to now — undefined
 *  while the workspace is still loading (#72). The second of the fold's two adapters. */
export interface ReopenedRun {
  run: RunMeta
  chain: ChainDef | undefined
}

type Action =
  | { type: 'start'; chain: ChainDef; seed: SeedSource; startedAt: number; paramValue: string; modelOverride?: string }
  | { type: 'event'; event: RunEvent }
  | { type: 'settle'; at: number }

function reduceResultView(state: ResultViewState, action: Action): ResultViewState {
  switch (action.type) {
    case 'start': return startResultView(action)
    case 'event': return applyResultEvent(state, action.event)
    case 'settle': return settleResultView(state, action.at)
  }
}

/** How often a live run's elapsed time is re-read. */
const TICK_MS = 500

/** What both surfaces render from. */
export interface ResultViewHandle extends ResultView {
  states: RunStateMap
  order: string[]
  /** False until a run exists to show — the form is the whole screen until then. */
  started: boolean
  running: boolean
  /** The finished run's id, once the stream named one; null for a run being read on
   *  its own history page, which has nowhere to link. */
  runId: string | null
  deck: PanelDeck & { reset: () => void }
  fit: PanelFit
  setFit: (next: PanelFit) => void
}

/** The live surface also drives the fold; a reopened run is handed one already folded. */
export interface LiveResultViewHandle extends ResultViewHandle {
  /** Begins a new run: one call, so no half of the previous one survives into it. */
  start: (input: { chain: ChainDef; seed: SeedSource; paramValue: string; modelOverride?: string }) => void
  apply: (event: RunEvent) => void
  /** The stream closed, however it closed. */
  settle: () => void
}

/**
 * The result view both surfaces render (#106). Called bare, it is the live page's and
 * takes the run stream; called with a reopened run, it takes that instead and the
 * caller drives nothing.
 */
export function useResultView(): LiveResultViewHandle
export function useResultView(past: ReopenedRun): ResultViewHandle
export function useResultView(past?: ReopenedRun): LiveResultViewHandle {
  const [streamed, dispatch] = useReducer(reduceResultView, idleResultView)
  const deck = usePanelDeck()
  const [fit, setFit] = usePanelFit()

  // A hook cannot be called conditionally, so both adapters run every render and the
  // reopened one wins where there is one.
  const pastRun = past?.run
  const pastChain = past?.chain
  const fromLog = useMemo(() => (pastRun ? resultViewFromMeta(pastRun, pastChain) : null), [pastRun, pastChain])
  const state = fromLog ?? streamed

  const running = state.run !== null && state.endedAt === undefined
  // Only a live run reads the clock: a settled one measures against its own `endedAt`.
  // Seeded rather than left at the epoch, so a reader that ever does consult it on a
  // settled run gets a time rather than 1970.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  const view = useMemo(() => projectResultView(state, now), [state, now])

  const reset = deck.reset
  const start = useCallback((input: { chain: ChainDef; seed: SeedSource; paramValue: string; modelOverride?: string }) => {
    const startedAt = Date.now()
    reset()
    setNow(startedAt)
    dispatch({ type: 'start', startedAt, ...input })
  }, [reset])
  const apply = useCallback((event: RunEvent) => dispatch({ type: 'event', event }), [])
  const settle = useCallback(() => dispatch({ type: 'settle', at: Date.now() }), [])

  return {
    ...view,
    states: state.states,
    order: state.order,
    started: state.run !== null,
    running,
    runId: state.runId,
    deck,
    fit,
    setFit,
    start,
    apply,
    settle,
  }
}
