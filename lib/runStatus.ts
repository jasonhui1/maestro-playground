import type { RunMeta } from './types'
import type { VarianceGroup } from './variance'

export interface StatusStyle {
  label: string
  /** Glyph colour for the `●` mark. */
  dotClass: string
  /** Filled-circle background for a bare dot. */
  dotBgClass: string
  textClass: string
}

export const STATUS_CONFIG: Record<RunMeta['status'], StatusStyle> = {
  complete: { label: 'done', dotClass: 'text-emerald-500', dotBgClass: 'bg-green-500', textClass: 'text-emerald-700' },
  waiting: { label: 'hold', dotClass: 'text-amber-500', dotBgClass: 'bg-amber-500', textClass: 'text-amber-700' },
  running: { label: 'running', dotClass: 'text-blue-500 animate-pulse', dotBgClass: 'bg-blue-500 animate-pulse', textClass: 'text-blue-700' },
  error: { label: 'error', dotClass: 'text-rose-500', dotBgClass: 'bg-red-500', textClass: 'text-rose-700' },
}

export function statusStyle(status: RunMeta['status']): StatusStyle {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.running
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
