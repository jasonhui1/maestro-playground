import type { AgentOutput, RunMeta } from './types'
import type { VarianceGroup } from './variance'
import { isModelPriced, unpricedWarning } from './pricing'

/** The part of an output that cost is read from. */
export interface CostEntry {
  costUsd?: number
  model?: string
}

export interface CostSummary {
  /** Sum of the priced entries; absent when none was priced (or the total is withheld). */
  costUsd?: number
  pricedCount: number
  unpricedCount: number
  unpricedModels: string[]
  /** `no price for a, b` whenever any entry was unpriced. */
  costWarning?: string
}

export interface CostOptions {
  /** Models that will run but have produced nothing yet; counted unpriced when no price is known. */
  pendingModels?: string[]
  /** Report no total at all once any entry is unpriced, instead of a partial sum. The variance
   *  group's API shape asks for this (#133); every other view sums what is priced. */
  withholdPartialTotal?: boolean
}

/** The one rule: sum what is priced, report what is not. */
export function summarizeCost(entries: CostEntry[], options: CostOptions = {}): CostSummary {
  let sum = 0
  let pricedCount = 0
  let unpricedCount = 0
  const unpriced = new Set<string>()
  const noteUnpriced = (model?: string) => {
    unpricedCount++
    if (model?.trim()) unpriced.add(model.trim())
  }

  for (const model of options.pendingModels ?? []) {
    if (!isModelPriced(model)) noteUnpriced(model)
  }
  for (const entry of entries) {
    if (typeof entry.costUsd === 'number') {
      pricedCount++
      sum += entry.costUsd
    } else {
      noteUnpriced(entry.model)
    }
  }

  const unpricedModels = Array.from(unpriced)
  const hasTotal = pricedCount > 0 && !(options.withholdPartialTotal && unpricedCount > 0)
  return {
    ...(hasTotal ? { costUsd: sum } : {}),
    pricedCount,
    unpricedCount,
    unpricedModels,
    ...(unpricedCount > 0 ? { costWarning: unpricedWarning(unpricedModels) } : {}),
  }
}

export interface Ledger extends CostSummary {
  status: RunMeta['status']
  steps: number
  tokens: number
  durationMs: number
}

function tokensOf(outputs: AgentOutput[]): number {
  return outputs.reduce((sum, o) => sum + (o.tokensIn || 0) + (o.tokensOut || 0), 0)
}

function runDurationMs(run: RunMeta): number {
  if (run.completedAt && run.startedAt) {
    const start = new Date(run.startedAt).getTime()
    const end = new Date(run.completedAt).getTime()
    if (!isNaN(start) && !isNaN(end) && end >= start) return end - start
  }
  return run.agentOutputs.reduce((sum, o) => sum + (o.latencyMs || 0), 0)
}

/** Aggregate status across all runs in a variance group (#142). */
export function varianceGroupStatus(group: Pick<VarianceGroup, 'runs' | 'expectedRunCount' | 'completedRunCount'>): RunMeta['status'] {
  if (group.runs.some(r => r.status === 'error')) return 'error'
  if (group.completedRunCount === group.expectedRunCount && group.runs.every(r => r.status === 'complete')) {
    return 'complete'
  }
  if (group.runs.some(r => r.status === 'waiting')) return 'waiting'
  return 'running'
}

/** One run, or a variance group read as the sum of its runs; duration is the slowest run's. */
export function summarize(subject: RunMeta | VarianceGroup): Ledger {
  const isGroup = 'runs' in subject
  const runs = isGroup ? subject.runs : [subject]
  const outputs = runs.flatMap(r => r.agentOutputs)
  return {
    status: isGroup ? varianceGroupStatus(subject) : subject.status,
    steps: outputs.length,
    tokens: tokensOf(outputs),
    durationMs: runs.reduce((max, r) => Math.max(max, runDurationMs(r)), 0),
    ...summarizeCost(outputs),
  }
}
