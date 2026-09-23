import { useState, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import type { RunFrameModel } from '@/lib/runFrame'
import type { ChangedSinceResult, FileVersionChange } from '@/lib/changedSince'
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/lib/panelCopy'
import { TYPE } from '@/lib/resultType'
import { VersionDiffModal } from '@/components/result/VersionDiffModal'
import { UnpricedBadge } from '@/components/UnpricedBadge'

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
 * output starts at the fold and keeps the page (#65). The rail stays put while the
 * output scrolls: it is reference, and reference that scrolls away has to be scrolled
 * back to.
 */
export function RunFrame({ frame, runId, selectedCount, onCompare, onCompareSource, changedSince: explicitChangedSince, actions, children }: {
  frame: RunFrameModel
  /** Absent until the run completes — the log has no id to link to before then. */
  runId?: string | null
  selectedCount: number
  /** Opens the compare overlay; the trigger needs two panels ticked before it fires. */
  onCompare: () => void
  /** Opens the fork diff comparison overlay (#130). */
  onCompareSource?: () => void
  /** Pinned version differences since the previous run of the same chain (#131). */
  changedSince?: ChangedSinceResult | null
  /** Page-level controls the rail absorbs, so the page spends no band above the output. */
  actions?: ReactNode
  children: ReactNode
}) {
  const [fetchedChange, setFetchedChange] = useState<ChangedSinceResult | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<FileVersionChange | null>(null)

  const changeData = explicitChangedSince ?? frame.changedSince ?? fetchedChange

  useEffect(() => {
    if (explicitChangedSince || frame.changedSince || !runId) return
    let cancelled = false
    fetch(`/api/runs/${runId}/changed-since`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelled && data) setFetchedChange(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [runId, explicitChangedSince, frame.changedSince])
  return (
    <div className="flex items-stretch gap-6">
      <aside className="w-40 shrink-0 border-r border-zinc-200">
        <div className="sticky top-14 flex flex-col gap-5 pr-5 py-1 text-xs max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="flex flex-col gap-1 min-w-0">
            <span className={`${TYPE.title} text-zinc-800 break-words`}>{frame.chainName}</span>
            {frame.moment && <span className="text-zinc-400 leading-snug">{frame.moment}</span>}
            <span className={`${TYPE.ui} font-medium ${RUN_STATUS_TONE[frame.status]}`}>
              {RUN_STATUS_LABEL[frame.status]}
            </span>
          </div>

          {/* The failure sits with the result it explains. It used to render in the launch
              form, hundreds of pixels above panels that went on reading "waiting". */}
          {frame.error && (
            <p className="text-red-600 leading-snug break-words border-l-2 border-red-200 pl-2">
              {frame.error}
            </p>
          )}

          <dl className="flex flex-col gap-2 text-zinc-400">
            <div className="flex flex-col">
              <dt className={TYPE.label}>seed</dt>
              <dd className="text-zinc-600 break-words">{frame.seedSource}</dd>
            </div>
            {frame.parameter && (
              <div className="flex flex-col">
                <dt className={TYPE.label}>{frame.parameter.name}</dt>
                <dd className="text-zinc-600 break-words">{frame.parameter.value}</dd>
              </div>
            )}
            {frame.models && frame.models.length > 0 && (
              <div className="flex flex-col">
                <dt className={TYPE.label}>{frame.models.length === 1 ? 'model' : 'models'}</dt>
                {frame.models.map((m, idx) => (
                  <dd key={idx} className="font-mono text-zinc-600 break-words">
                    {m.model}{m.source ? ` (${m.source === 'run override' ? 'override' : m.source})` : ''}
                  </dd>
                ))}
              </div>
            )}
            <div className="flex flex-col">
              <dt className={TYPE.label}>elapsed</dt>
              <dd className="font-mono text-zinc-600">{formatElapsed(frame.elapsedMs)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={TYPE.label}>cost</dt>
              <dd
                className="font-mono text-zinc-600 flex flex-wrap items-center gap-1"
                title={frame.costWarning ?? (frame.unpricedModels?.length ? `Unpriced models: ${frame.unpricedModels.join(', ')}` : undefined)}
              >
                {frame.costUsd !== undefined ? (
                  frame.unpricedCount && frame.unpricedCount > 0 ? (
                    <>
                      <span>${frame.costUsd.toFixed(4)}</span>
                      <UnpricedBadge count={frame.unpricedCount} />
                    </>
                  ) : (
                    `$${frame.costUsd.toFixed(4)}`
                  )
                ) : (
                  'unpriced'
                )}
              </dd>
              {frame.costWarning && (
                <dd className="text-amber-600 text-[11px] leading-tight mt-0.5">{frame.costWarning}</dd>
              )}
            </div>
          </dl>

          {changeData && changeData.status !== 'unavailable' && (
            <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-3">
              <span className={TYPE.label}>pinned files (run start)</span>
              {changeData.status === 'changed' && changeData.predecessor && (
                <>
                  <div className="text-zinc-500 font-medium text-[11px] leading-tight">
                    Since run{' '}
                    <Link
                      href={`/history/${changeData.predecessor.runId}`}
                      className="font-mono text-zinc-700 underline underline-offset-2 hover:text-black break-all"
                    >
                      {changeData.predecessor.runId}
                    </Link>
                    :
                  </div>
                  <div className="flex flex-col gap-1 mt-0.5">
                    {changeData.files.filter(f => f.status !== 'same').map(file => (
                      <button
                        key={file.key}
                        type="button"
                        onClick={() => setSelectedDiffFile(file)}
                        className="text-left group flex flex-col p-1.5 rounded hover:bg-zinc-50 transition-colors border border-transparent hover:border-zinc-200"
                        title="Click to view version diff"
                      >
                        <span className="font-mono text-[11px] font-semibold text-zinc-800 group-hover:text-blue-600 truncate">
                          {file.key}
                        </span>
                        <span className="text-[10px] text-zinc-500 leading-tight">
                          {file.summary}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {changeData.status === 'identical' && changeData.predecessor && (
                <div className="text-zinc-500 text-[11px] leading-snug">
                  same source-file versions as run{' '}
                  <Link
                    href={`/history/${changeData.predecessor.runId}`}
                    className="font-mono text-zinc-700 underline underline-offset-2 hover:text-black break-all"
                  >
                    {changeData.predecessor.runId}
                  </Link>
                </div>
              )}
              {changeData.status === 'no_predecessor' && (
                <div className="text-zinc-400 text-[10px] italic">
                  first run
                </div>
              )}
              {changeData.continuationCaveat && (
                <div className="text-[10px] text-amber-600 leading-tight mt-1">
                  Pinned at run start; continuation executed live files.
                </div>
              )}
            </div>
          )}

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
            {onCompareSource && (
              <button
                type="button"
                onClick={onCompareSource}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 font-medium text-zinc-700
                  hover:bg-zinc-50 transition-colors outline-none
                  focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                Compare with source
              </button>
            )}
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

      {selectedDiffFile && (
        <VersionDiffModal
          file={selectedDiffFile}
          onClose={() => setSelectedDiffFile(null)}
        />
      )}
    </div>
  )
}
