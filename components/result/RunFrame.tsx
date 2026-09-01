'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type { RunFrameModel } from '@/lib/runFrame'

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * The one frame every result layout renders into (#73). It carries what is true of any
 * run whatever shape it reads in; the region below it is the only thing that varies.
 */
export function RunFrame({ frame, runId, selectedCount, onCompare, children }: {
  frame: RunFrameModel
  /** Absent until the run completes — the log has no id to link to before then. */
  runId?: string | null
  selectedCount: number
  /** Left out until the compare overlay lands (#71); the trigger then reads as disabled. */
  onCompare?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-lg font-semibold text-zinc-800 truncate">{frame.chainName}</span>
          {frame.moment && <span className="text-sm text-zinc-500">{frame.moment}</span>}
          <span className="text-xs text-zinc-400">seed: {frame.seedSource}</span>
        </div>

        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="font-mono">{formatElapsed(frame.elapsedMs)}</span>
          <span className="font-mono">${frame.costUsd.toFixed(4)}</span>
          <button
            type="button"
            onClick={onCompare}
            disabled={!onCompare || selectedCount < 2}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 font-medium text-zinc-700
              disabled:opacity-40 hover:bg-zinc-50 transition-colors"
          >
            Compare{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
          {runId && (
            <Link href={`/history/${runId}`} className="underline underline-offset-4">full log</Link>
          )}
        </div>
      </div>

      {children}
    </div>
  )
}
