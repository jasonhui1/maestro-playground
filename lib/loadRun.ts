import { readRunMeta } from './logger'
import type { Refusal, RunMeta } from './types'

/**
 * The run a run-scoped route acts on, or why not. `mustNotBeRunning` guards writers:
 * a running stretch rewrites meta.json when it ends, dropping what they wrote.
 */
export function loadRunFor(runId: string, { mustNotBeRunning = false } = {}): RunMeta | Refusal {
  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return { error: 'Run not found', status: 404 }
  }
  if (mustNotBeRunning && meta.status === 'running') return { error: 'Run is running', status: 409 }
  return meta
}
