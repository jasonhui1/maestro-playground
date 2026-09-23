'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ExternalLink } from 'lucide-react'
import type { VarianceGroup } from '@/lib/variance'
import type { RunMeta } from '@/lib/types'
import { formatDuration, formatClockTime, formatDate } from '@/components/RunCard'

export interface VarianceRunCardProps {
  group: VarianceGroup
}

export function VarianceRunCard({ group }: VarianceRunCardProps) {
  const [expanded, setExpanded] = useState(false)

  const spreads = group.nodes.flatMap(node => node.spread === undefined ? [] : [node.spread])
  const widest = spreads.length > 0 ? Math.max(...spreads).toFixed(2) : 'n/a'

  const hasError = group.runs.some(r => r.status === 'error')
  const hasWaiting = group.runs.some(r => r.status === 'waiting')
  const isAllComplete = group.completedRunCount === group.expectedRunCount
  const varianceStatus: RunMeta['status'] = hasError ? 'error' : isAllComplete ? 'complete' : hasWaiting ? 'waiting' : 'running'

  const STATUS_CONFIG: Record<RunMeta['status'], { label: string; dotClass: string; textClass: string }> = {
    complete: { label: 'done', dotClass: 'text-emerald-500', textClass: 'text-emerald-700' },
    waiting: { label: 'hold', dotClass: 'text-amber-500', textClass: 'text-amber-700' },
    running: { label: 'running', dotClass: 'text-blue-500 animate-pulse', textClass: 'text-blue-700' },
    error: { label: 'error', dotClass: 'text-rose-500', textClass: 'text-rose-700' },
  }
  const statusStyle = STATUS_CONFIG[varianceStatus] ?? STATUS_CONFIG.running

  const totalTokens = group.runs.reduce((acc, r) =>
    acc + r.agentOutputs.reduce((sum, o) => sum + (o.tokensIn || 0) + (o.tokensOut || 0), 0)
  , 0)

  const startedAt = group.runs[0]?.startedAt || ''
  const href = `/variance/${encodeURIComponent(group.groupId)}`

  return (
    <>
      <tr
        onClick={() => setExpanded(prev => !prev)}
        className={`cursor-pointer transition-colors group ${
          expanded ? 'bg-zinc-50/90' : 'hover:bg-zinc-50/60 bg-zinc-50/20'
        }`}
      >
        {/* Status */}
        <td className="py-3 px-4 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${statusStyle.textClass}`}>
              <span className={`text-[10px] leading-none ${statusStyle.dotClass}`}>●</span>
              <span>{statusStyle.label}</span>
            </span>
            <span className="rounded border border-violet-200 bg-violet-50 px-1 py-0.2 text-[9px] font-medium text-violet-700">
              ×{group.expectedRunCount}
            </span>
          </div>
        </td>

        {/* Chain */}
        <td className="py-3 px-4">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={href}
                onClick={e => e.stopPropagation()}
                className="font-bold text-zinc-900 hover:text-black hover:underline truncate"
                title={group.chainName}
              >
                {group.chainName}
              </Link>
            </div>
            <Link
              href={href}
              onClick={e => e.stopPropagation()}
              className="text-[10px] text-zinc-400 hover:text-zinc-600 font-mono tracking-tight truncate"
              title={group.groupId}
            >
              {group.groupId}
            </Link>
          </div>
        </td>

        {/* Prompt */}
        <td className="py-3 px-4">
          <div className="truncate text-xs text-zinc-600 max-w-xs md:max-w-sm lg:max-w-md" title={group.seedPrompt}>
            {group.seedPrompt ? (
              group.seedPrompt
            ) : (
              <span className="italic text-zinc-400">Empty prompt</span>
            )}
          </div>
        </td>

        {/* Drift / Spread */}
        <td className="py-3 px-4 whitespace-nowrap">
          {widest !== 'n/a' ? (
            <span
              className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-50 text-violet-800 border border-violet-200"
              title={`Widest node spread: ${widest}`}
            >
              spread {widest}
            </span>
          ) : (
            <span className="text-zinc-400 font-mono text-xs">—</span>
          )}
        </td>

        {/* Steps */}
        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span
            className="font-mono text-xs text-zinc-700"
            title={`${group.completedRunCount} of ${group.expectedRunCount} complete · ${group.nodes.length} nodes`}
          >
            {group.nodes.length}
          </span>
        </td>

        {/* Tokens */}
        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span className="font-mono text-xs text-zinc-700">
            {totalTokens > 0 ? totalTokens.toLocaleString() : '0'}
          </span>
        </td>

        {/* Cost */}
        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span className="font-mono text-xs text-zinc-900 font-medium">
            {group.costUsd !== undefined ? `$${group.costUsd.toFixed(4)}` : '—'}
          </span>
        </td>

        {/* Time */}
        <td className="py-3 px-4 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-2">
            <div className="flex flex-col items-end">
              <span className="font-mono text-xs font-medium text-zinc-900">
                {group.completedRunCount}/{group.expectedRunCount} runs
              </span>
              {startedAt && (
                <time
                  dateTime={startedAt}
                  className="text-[10px] text-zinc-400"
                  title={new Date(startedAt).toLocaleString()}
                >
                  {formatDate(startedAt)} {formatClockTime(startedAt)}
                </time>
              )}
            </div>
            <Link
              href={href}
              onClick={e => e.stopPropagation()}
              className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              title="Open variance analysis"
            >
              <ExternalLink size={13} />
            </Link>
            <ChevronDown
              size={14}
              className={`text-zinc-400 transition-transform duration-200 ${expanded ? 'rotate-180 text-zinc-700' : ''}`}
            />
          </div>
        </td>
      </tr>

      {/* Expandable Variance Drawer (#142) */}
      {expanded && (
        <tr className="bg-zinc-50/80 border-b border-zinc-200">
          <td colSpan={8} className="p-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-700">
                    Variance Group
                  </span>
                  <span className="font-mono text-xs text-zinc-400">{group.groupId}</span>
                  <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                    variance ×{group.expectedRunCount}
                  </span>
                </div>
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 transition-colors shadow-sm"
                >
                  <span>Open Variance Analysis</span>
                  <ExternalLink size={13} />
                </Link>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                  Seed Prompt
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-3.5 text-xs text-zinc-800 font-mono whitespace-pre-wrap leading-relaxed select-text shadow-xs max-h-48 overflow-y-auto">
                  {group.seedPrompt || <span className="italic text-zinc-400">No seed prompt provided</span>}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-lg border border-zinc-200 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Completed</span>
                  <span className="font-mono font-medium text-zinc-800">{group.completedRunCount} of {group.expectedRunCount}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Widest Spread</span>
                  <span className="font-mono font-medium text-zinc-800">{widest}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Tokens</span>
                  <span className="font-mono font-medium text-zinc-800">{totalTokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Cost</span>
                  <span className="font-mono font-medium text-zinc-800">{group.costUsd !== undefined ? `$${group.costUsd.toFixed(4)}` : 'unpriced'}</span>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Group Runs ({group.runs.length})
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {group.runs.map((r, idx) => (
                    <div
                      key={r.runId}
                      className="flex items-center justify-between text-xs p-2.5 rounded-md bg-white border border-zinc-200"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[10px] font-mono text-zinc-400">#{idx + 1}</span>
                        <Link
                          href={`/history/${r.runId}`}
                          className="font-mono text-zinc-900 hover:underline font-medium"
                        >
                          {r.runId}
                        </Link>
                        <span className="text-[10px] font-medium text-zinc-500 uppercase">({r.status})</span>
                      </div>
                      <div className="flex items-center gap-3 text-zinc-500 font-mono text-[11px] shrink-0">
                        <span>{r.agentOutputs.length} steps</span>
                        <Link
                          href={`/history/${r.runId}`}
                          className="text-zinc-600 hover:text-zinc-900 underline underline-offset-2"
                        >
                          trace &rarr;
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default VarianceRunCard
