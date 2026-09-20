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

/** The two adapters the one fold has: a run streaming now, or one read from disk (#106). */
export type ResultSource =
  | { kind: 'stream' }
  | { kind: 'meta'; run: RunMeta; chain: ChainDef | undefined }

type Action =
  | { type: 'start'; chain: ChainDef; seed: SeedSource; startedAt: number; paramValue: string }
  | { type: 'event'; event: RunEvent }
  | { type: 'settle'; at: number }

function reduce(state: ResultViewState, action: Action): ResultViewState {
  switch (action.type) {
    case 'start': return startResultView(action)
    case 'event': return applyResultEvent(state, action.event)
    case 'settle': return settleResultView(state, action.at)
  }
}

/** How often a live run's elapsed time is re-read. */
const TICK_MS = 500

export interface ResultViewHandle extends ResultView {
  states: RunStateMap
  order: string[]
  /** The finished run's id, once the stream named one; null for a run being read from
   *  its own history page. */
  runId: string | null
  running: boolean
  deck: PanelDeck & { reset: () => void }
  fit: PanelFit
  setFit: (next: PanelFit) => void
  /** Begins a new run: one call, so no half of the previous one survives into it. */
  start: (input: { chain: ChainDef; seed: SeedSource; paramValue: string }) => void
  apply: (event: RunEvent) => void
  /** The stream closed, however it closed. */
  settle: () => void
}

/**
 * The result view both surfaces render. The stream adapter drives it with
 * `start`/`apply`/`settle`; the meta adapter hands it a run and drives nothing.
 */
export function useResultView(source: ResultSource = { kind: 'stream' }): ResultViewHandle {
  const [streamed, dispatch] = useReducer(reduce, idleResultView)
  const deck = usePanelDeck()
  const [fit, setFit] = usePanelFit()

  // Both branches are computed every render — a hook cannot be called conditionally —
  // and the disk one wins when there is one.
  const meta = source.kind === 'meta' ? source.run : undefined
  const metaChain = source.kind === 'meta' ? source.chain : undefined
  const fromDisk = useMemo(() => (meta ? resultViewFromMeta(meta, metaChain) : null), [meta, metaChain])
  const state = fromDisk ?? streamed

  const running = state.run !== null && state.endedAt === undefined
  // Only a live run reads the clock: a settled one has an `endedAt` to measure against.
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  const view = useMemo(() => projectResultView(state, now), [state, now])

  const reset = deck.reset
  const start = useCallback((input: { chain: ChainDef; seed: SeedSource; paramValue: string }) => {
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
    runId: state.runId,
    running,
    deck,
    fit,
    setFit,
    start,
    apply,
    settle,
  }
}
