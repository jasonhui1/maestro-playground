import { ChainDef } from './types'
import { RunStateMap } from './runState'

/** Where the run's seed came from — the two shapes the result view offers (#66). */
export type SeedSource = { kind: 'paste' } | { kind: 'file'; name: string }

/** What is true of every run whatever shape its result reads in (#73). */
export interface RunFrameModel {
  chainName: string
  /** The situation that should make you reach for this chain; `description` when unstated (ADR-0016). */
  moment: string
  seedSource: string
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
}): RunFrameModel {
  const { chain, seed, states, startedAt, endedAt, now } = input
  return {
    chainName: chain.name,
    moment: chain.moment || chain.description,
    seedSource: seed.kind === 'file' ? seed.name : 'pasted text',
    elapsedMs: startedAt === undefined ? 0 : Math.max(0, (endedAt ?? now) - startedAt),
    costUsd: costOf(states),
  }
}
