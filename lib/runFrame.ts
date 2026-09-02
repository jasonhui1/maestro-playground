import { ChainDef } from './types'
import { RunStateMap } from './runState'

/** Where the run's seed came from — the two shapes the result view offers (#66), plus
 *  `log` for a past run reopened from history, which never recorded which one it was (#72),
 *  and `pinned` for a chain that declares no seed node and reads its own files instead. */
export type SeedSource =
  | { kind: 'paste' }
  | { kind: 'file'; name: string }
  | { kind: 'log' }
  | { kind: 'pinned'; files: string[] }

/**
 * `running` — at least one node is still working, or none has finished.
 * `done`    — the run settled and no node failed.
 * `failed`  — the run settled and a node failed, or the request itself errored.
 */
export type RunStatus = 'running' | 'done' | 'failed'

/** What is true of every run whatever shape its result reads in (#73). */
export interface RunFrameModel {
  chainName: string
  /** The situation that should make you reach for this chain; `description` when unstated (ADR-0016). */
  moment: string
  seedSource: string
  /** The dropdown the chain declared and what it was set to, when it declared one (#65). */
  parameter?: { name: string; value: string }
  status: RunStatus
  /** Why the run failed — the engine's message, or the request error. */
  error?: string
  elapsedMs: number
  costUsd: number
}

// A loop-body node reports once per round and the run paid for every one, so rounds
// win over the node's last result wherever they exist.
function costOf(states: RunStateMap): number {
  return Object.values(states).reduce((sum, s) => {
    if (s.rounds.length > 0) return sum + s.rounds.reduce((r, x) => r + x.metrics.costUsd, 0)
    return sum + (s.result?.costUsd ?? 0)
  }, 0)
}

function describeSeed(seed: SeedSource): string {
  switch (seed.kind) {
    case 'file': return seed.name
    case 'log': return 'the run\'s recorded seed'
    case 'pinned': return seed.files.length > 0 ? `${seed.files.join(', ')} (pinned by the chain)` : 'the files the chain pins'
    case 'paste': return 'pasted text'
  }
}

/** The first failure the run reported, whichever node carried it. */
function failureOf(states: RunStateMap): string | undefined {
  for (const s of Object.values(states)) {
    if (s.status === 'error') return s.result?.error || 'the run failed'
  }
  return undefined
}

/**
 * Project a run onto the frame every layout renders into (#73).
 *
 * Reads only what holds regardless of layout, so the three declared views and the
 * run-trace fallback share one header rather than each inventing chrome.
 */
export function buildRunFrame(input: {
  chain: ChainDef
  seed: SeedSource
  states: RunStateMap
  /** Absent until the run starts; `endedAt` absent while it is still live. */
  startedAt?: number
  endedAt?: number
  now: number
  /** The chain's declared dropdown and its value. A live run reads it from the chain it
   *  is about to run; a reopened run reads it from the log, which recorded both (#65). */
  parameter?: { name: string; value: string }
  /** A failure the run never got far enough to report through a node. */
  requestError?: string
}): RunFrameModel {
  const { chain, seed, states, startedAt, endedAt, now, parameter, requestError } = input
  const nodeFailure = failureOf(states)
  const error = requestError ?? nodeFailure
  // A run is live until it has an end: `endedAt` is what the caller sets when the
  // stream closes, however it closed.
  const status: RunStatus = endedAt === undefined ? 'running' : error ? 'failed' : 'done'

  const frame: RunFrameModel = {
    chainName: chain.name,
    moment: chain.moment || chain.description,
    seedSource: describeSeed(seed),
    status,
    elapsedMs: startedAt === undefined ? 0 : Math.max(0, (endedAt ?? now) - startedAt),
    costUsd: costOf(states),
  }
  if (error) frame.error = error
  if (parameter) frame.parameter = parameter
  return frame
}
