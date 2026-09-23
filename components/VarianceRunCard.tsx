'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { varianceGroupStatus, type VarianceGroup } from '@/lib/variance'
import { formatDuration, formatClockTime, formatDate, getRunDurationMs, STATUS_CONFIG } from '@/components/RunCard'

export interface VarianceRunCardProps {
  group: VarianceGroup
}

export function VarianceRunCard({ group }: VarianceRunCardProps) {
  const [expanded, setExpanded] = useState(false)

  const spreads = group.nodes.flatMap(node => node.spread === undefined ? [] : [node.spread])
  const widest = spreads.length > 0 ? Math.max(...spreads).toFixed(2) : 'n/a'

  const varianceStatus = varianceGroupStatus(group)
  const statusStyle = STATUS_CONFIG[varianceStatus] ?? STATUS_CONFIG.running

  const totalSteps = group.runs.reduce((sum, r) => sum + r.agentOutputs.length, 0)
  const totalTokens = group.runs.reduce((acc, r) =>
    acc + r.agentOutputs.reduce((sum, o) => sum + (o.tokensIn || 0) + (o.tokensOut || 0), 0)
  , 0)
  const durationMs = group.runs.reduce((max, r) => Math.max(max, getRunDurationMs(r)), 0)

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

        <td className="py-3 px-4">
          <div className="truncate text-xs text-zinc-600 max-w-xs md:max-w-sm lg:max-w-md" title={group.seedPrompt}>
            {group.seedPrompt ? (
              group.seedPrompt
            ) : (
              <span className="italic text-zinc-400">Empty prompt</span>
            )}
          </div>
        </td>

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

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span
            className="font-mono text-xs text-zinc-700"
            title={`${totalSteps} total steps across ${group.runs.length} runs`}
          >
            {totalSteps}
          </span>
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span className="font-mono text-xs text-zinc-700">
            {totalTokens > 0 ? totalTokens.toLocaleString() : '0'}
          </span>
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span className="font-mono text-xs text-zinc-900 font-medium">
            {group.costUsd !== undefined ? `$${group.costUsd.toFixed(4)}` : '—'}
          </span>
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-2">
            <div className="flex flex-col items-end">
              <span className="font-mono text-xs font-medium text-zinc-900">
                {formatDuration(durationMs)}
              </span>
              {startedAt && (
                <time
                  dateTime={startedAt}
                  className="text-[10px] text-zinc-400 font-mono"
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
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default VarianceRunCard
