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
 * run whatever shape it reads in; the region beside it is the only thing that varies.
 *
 * The run's identity lives in a narrow rail rather than a band across the top, so the
 * output starts at the fold and keeps the page (chosen on screen, 2026-09-02). The rail
 * stays put while the output scrolls: it is reference, and reference that scrolls away
 * has to be scrolled back to.
 */
export function RunFrame({ frame, runId, selectedCount, onCompare, actions, children }: {
  frame: RunFrameModel
  /** Absent until the run completes — the log has no id to link to before then. */
  runId?: string | null
  selectedCount: number
  /** Opens the compare overlay; the trigger needs two panels ticked before it fires. */
  onCompare: () => void
  /** Page-level controls the rail absorbs, so the page spends no band above the output. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-stretch gap-6">
      <aside className="w-40 shrink-0 border-r border-zinc-200">
        <div className="sticky top-14 flex flex-col gap-5 pr-5 py-1 text-xs max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-semibold text-zinc-800 break-words">{frame.chainName}</span>
            {frame.moment && <span className="text-zinc-400 leading-snug">{frame.moment}</span>}
          </div>

          <dl className="flex flex-col gap-2 text-zinc-400">
            <div className="flex flex-col">
              <dt className="text-[10px] uppercase tracking-[0.14em]">seed</dt>
              <dd className="text-zinc-600 break-words">{frame.seedSource}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-[10px] uppercase tracking-[0.14em]">elapsed</dt>
              <dd className="font-mono text-zinc-600">{formatElapsed(frame.elapsedMs)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-[10px] uppercase tracking-[0.14em]">cost</dt>
              <dd className="font-mono text-zinc-600">${frame.costUsd.toFixed(4)}</dd>
            </div>
          </dl>

          <div className="flex flex-col items-start gap-3">
            <button
              type="button"
              onClick={onCompare}
              disabled={selectedCount < 2}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 font-medium text-zinc-700
                disabled:opacity-40 hover:bg-zinc-50 transition-colors outline-none
                focus-visible:ring-2 focus-visible:ring-zinc-900"
            >
              Compare{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
            {runId && (
              <Link href={`/history/${runId}`} className="text-zinc-400 underline underline-offset-4 hover:text-zinc-700">
                full log
              </Link>
            )}
            {actions}
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
