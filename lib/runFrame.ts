import { ChainDef, FieldSource } from './types'
import { RunStateMap } from './runState'

/** Where the run's seed came from — the two shapes the result view offers (#66), plus
 *  `log` for a past run reopened from history, which never recorded which one it was (#72),
 *  and `pinned` for a chain that declares no seed node and reads its own files instead. */
export type SeedSource =
  | { kind: 'paste' }
  | { kind: 'file'; name: string }
  | { kind: 'log' }
  | { kind: 'pinned'; files: string[] }

import { isModelPriced } from './pricing'

/**
 * `running` — at least one node is still working, or none has finished.
 * `waiting` — the run paused at a hold node.
 * `done`    — the run settled and no node failed.
 * `failed`  — the run settled and a node failed, or the request itself errored.
 */
export type RunStatus = 'running' | 'waiting' | 'done' | 'failed'

/** What is true of every run whatever shape its result reads in (#73). */
export interface RunFrameModel {
  chainName: string
  /** The situation that should make you reach for this chain; `description` when unstated (ADR-0016). */
  moment: string
  seedSource: string
  /** The dropdown the chain declared and what it was set to, when it declared one (#65). */
  parameter?: { name: string; value: string }
  models?: Array<{ model: string; source?: FieldSource }>
  status: RunStatus
  /** Why the run failed — the engine's message, or the request error. */
  error?: string
  elapsedMs: number
  costUsd?: number
  costWarning?: string
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
  modelOverride?: string
  status?: RunStatus
}): RunFrameModel {
  const { chain, seed, states, startedAt, endedAt, now, parameter, requestError, modelOverride } = input
  const nodeFailure = failureOf(states)
  const error = requestError ?? nodeFailure
  // A run is live until it has an end: `endedAt` is what the caller sets when the
  // stream closes, however it closed.
  const status: RunStatus = input.status ?? (endedAt === undefined ? 'running' : error ? 'failed' : 'done')

  // #127, #128
  const models: Array<{ model: string; source?: FieldSource }> = []
  const seen = new Set<string>()
  if (modelOverride) {
    models.push({ model: modelOverride, source: 'run override' })
    seen.add(`${modelOverride}|run override`)
  }
  for (const s of Object.values(states)) {
    if (s.result?.model) {
      const key = `${s.result.model}|${s.result.modelSource ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        models.push({ model: s.result.model, source: s.result.modelSource })
      }
    }
  }

  // #126, #128
  let sum = 0
  let hasUnpriced = false
  const unpricedModels = new Set<string>()
  if (modelOverride && Object.values(states).every(s => !s.result && s.rounds.length === 0)) {
    if (!isModelPriced(modelOverride)) {
      hasUnpriced = true
      unpricedModels.add(modelOverride)
    }
  }
  for (const s of Object.values(states)) {
    if (s.rounds.length > 0) {
      for (const r of s.rounds) {
        if (r.metrics.costUsd === undefined) {
          hasUnpriced = true
          if (s.result?.model) unpricedModels.add(s.result.model)
        } else {
          sum += r.metrics.costUsd
        }
      }
    } else if (s.result) {
      if (s.result.costUsd === undefined) {
        hasUnpriced = true
        if (s.result.model) unpricedModels.add(s.result.model)
      } else {
        sum += s.result.costUsd
      }
    }
  }

  const costUsd = hasUnpriced ? undefined : sum
  const costWarning = unpricedModels.size > 0 ? `no price for ${Array.from(unpricedModels).join(', ')}` : undefined

  const frame: RunFrameModel = {
    chainName: chain.name,
    moment: chain.moment || chain.description,
    seedSource: describeSeed(seed),
    status,
    elapsedMs: startedAt === undefined ? 0 : Math.max(0, (endedAt ?? now) - startedAt),
    costUsd,
  }
  if (costWarning) frame.costWarning = costWarning
  if (models.length > 0) frame.models = models
  if (error) frame.error = error
  if (parameter) frame.parameter = parameter
  return frame
}
