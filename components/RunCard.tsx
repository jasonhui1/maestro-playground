'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { RunMeta } from '@/lib/types'
import { summarize } from '@/lib/runLedger'
import { statusStyle as styleOf } from '@/lib/runStatus'
import { formatDuration, formatClockTime, formatDate } from '@/lib/timeFormat'
import { UnpricedBadge } from '@/components/UnpricedBadge'
import type { ChangedSinceResult } from '@/lib/changedSince'

export interface RunCardProps {
  run: RunMeta
  /** Version differences compared to previous run of same chain (#131). */
  changedSince?: ChangedSinceResult
}

export function renderDrift(changedSince?: ChangedSinceResult) {
  if (!changedSince || changedSince.status === 'no_predecessor' || changedSince.status === 'unavailable') {
    return <span className="text-zinc-400 font-mono text-xs">—</span>
  }
  if (changedSince.status === 'identical') {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-zinc-50 text-zinc-600 border border-zinc-200"
        title={changedSince.summary}
      >
        identical
      </span>
    )
  }
  if (changedSince.status === 'changed') {
    const changedCount = changedSince.files.filter(f => f.status !== 'same').length
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200"
        title={changedSince.summary}
      >
        ± {changedCount} {changedCount === 1 ? 'file' : 'files'}
      </span>
    )
  }
  return <span className="text-zinc-400 font-mono text-xs">—</span>
}

export default function RunCard({ run, changedSince }: RunCardProps) {
  const [expanded, setExpanded] = useState(false)

  const ledger = summarize(run)
  const costTooltip = ledger.unpricedModels.length > 0 ? `Unpriced models: ${ledger.unpricedModels.join(', ')}` : undefined

  const statusStyle = styleOf(ledger.status)
  const isChat = run.chainName.startsWith('Chat with ')
  const href = isChat ? `/chat?runId=${run.runId}` : `/history/${run.runId}`

  return (
    <>
      <tr
        onClick={() => setExpanded(prev => !prev)}
        className={`cursor-pointer transition-colors group ${
          expanded ? 'bg-zinc-50/90' : 'hover:bg-zinc-50/60 bg-white'
        }`}
      >
        <td className="py-3 px-4 whitespace-nowrap">
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${statusStyle.textClass}`}>
            <span className={`text-[10px] leading-none ${statusStyle.dotClass}`}>●</span>
            <span>{statusStyle.label}</span>
          </span>
        </td>

        <td className="py-3 px-4">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={href}
                onClick={e => e.stopPropagation()}
                className="font-bold text-zinc-900 hover:text-black hover:underline truncate"
                title={run.chainName}
              >
                {run.chainName}
              </Link>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={href}
                onClick={e => e.stopPropagation()}
                className="text-[10px] text-zinc-400 hover:text-zinc-600 font-mono tracking-tight truncate"
                title={run.runId}
              >
                {run.runId}
              </Link>
              {run.versionNumber && (
                <span className="bg-zinc-100 text-zinc-500 text-[9px] px-1 rounded font-bold font-mono">
                  v{run.versionNumber}
                </span>
              )}
            </div>
          </div>
        </td>

        <td className="py-3 px-4">
          <div className="truncate text-xs text-zinc-600 max-w-xs md:max-w-sm lg:max-w-md" title={run.seedPrompt}>
            {run.seedPrompt ? (
              run.seedPrompt
            ) : (
              <span className="italic text-zinc-400">Empty prompt</span>
            )}
          </div>
        </td>

        <td className="py-3 px-4 whitespace-nowrap">
          {renderDrift(changedSince)}
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span className="font-mono text-xs text-zinc-700" title={`${ledger.steps} ${isChat ? 'turns' : 'steps'}`}>
            {ledger.steps}
          </span>
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <span className="font-mono text-xs text-zinc-700">
            {ledger.tokens > 0 ? ledger.tokens.toLocaleString() : '0'}
          </span>
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          {ledger.costUsd === undefined ? (
            <span
              className="font-mono text-xs text-zinc-900 font-medium"
              title={costTooltip}
            >
              {ledger.steps === 0 ? '—' : 'unpriced'}
            </span>
          ) : (
            <span
              className="font-mono text-xs text-zinc-900 font-medium inline-flex items-center gap-1 justify-end"
              title={costTooltip}
            >
              <span>${ledger.costUsd.toFixed(4)}</span>
              <UnpricedBadge count={ledger.unpricedCount} />
            </span>
          )}
        </td>

        <td className="py-3 px-4 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-2">
            <div className="flex flex-col items-end">
              <span className="font-mono text-xs font-medium text-zinc-900">
                {formatDuration(ledger.durationMs)}
              </span>
              <time
                dateTime={run.startedAt}
                className="text-[10px] text-zinc-400 font-mono"
                title={new Date(run.startedAt).toLocaleString()}
              >
                {formatDate(run.startedAt)} {formatClockTime(run.startedAt)}
              </time>
            </div>
            <Link
              href={href}
              onClick={e => e.stopPropagation()}
              className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              title={isChat ? 'Continue chat' : 'Open full trace'}
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
                    Run Transcript & Summary
                  </span>
                  <span className="font-mono text-xs text-zinc-400">{run.runId}</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${statusStyle.textClass}`}>
                    <span className={`text-[10px] leading-none ${statusStyle.dotClass}`}>●</span>
                    <span>{statusStyle.label}</span>
                  </span>
                </div>
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 transition-colors shadow-sm"
                >
                  <span>{isChat ? 'Continue Chat' : 'Open Full Trace'}</span>
                  <ExternalLink size={13} />
                </Link>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                  Seed Prompt
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-3.5 text-xs text-zinc-800 font-mono whitespace-pre-wrap leading-relaxed select-text shadow-xs max-h-48 overflow-y-auto">
                  {run.seedPrompt || <span className="italic text-zinc-400">No seed prompt provided</span>}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-lg border border-zinc-200 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Duration</span>
                  <span className="font-mono font-medium text-zinc-800">{formatDuration(ledger.durationMs)}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Tokens</span>
                  <span className="font-mono font-medium text-zinc-800">{ledger.tokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Cost</span>
                  <span className="font-mono font-medium text-zinc-800 inline-flex items-center gap-1" title={costTooltip}>
                    {ledger.costUsd === undefined ? (
                      'unpriced'
                    ) : (
                      <>
                        <span>${ledger.costUsd.toFixed(4)}</span>
                        <UnpricedBadge count={ledger.unpricedCount} />
                      </>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Steps</span>
                  <span className="font-mono font-medium text-zinc-800">
                    {ledger.steps} {isChat ? 'turns' : 'steps'}
                  </span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
