'use client'
import { useEffect, useState, useMemo } from 'react'
import { X, GitCompare, RefreshCw, CheckCircle2, PlusCircle, MinusCircle, AlertTriangle } from 'lucide-react'
import { buildCompareModel, type SpanKind } from '@/lib/compareModel'
import type { ForkComparison, ForkComparisonNode, ForkNodeStatus } from '@/lib/forkComparison'

const SPAN_CLASS: Record<SpanKind, string> = {
  same: '',
  cut: 'bg-red-100 text-red-900 line-through decoration-red-400',
  added: 'bg-green-100 text-green-900',
}

const STATUS_BADGE: Record<ForkNodeStatus, { label: string; tone: string; icon: typeof GitCompare }> = {
  reused: { label: 'reused', tone: 'bg-zinc-100 text-zinc-500 border-zinc-200', icon: CheckCircle2 },
  regenerated: { label: 'diff', tone: 'bg-amber-50 text-amber-800 border-amber-200', icon: RefreshCw },
  added: { label: 'added', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: PlusCircle },
  removed: { label: 'removed', tone: 'bg-rose-50 text-rose-800 border-rose-200', icon: MinusCircle },
}

function nodeKey(node: ForkComparisonNode): string {
  return `${node.nodeId}|${node.round ?? ''}`
}

function DiffColumn({
  title,
  badge,
  badgeTone = 'text-zinc-400',
  error,
  emptyMessage,
  monoTextClass = 'text-zinc-800',
  children,
}: {
  title?: string
  badge?: string
  badgeTone?: string
  error?: string
  emptyMessage?: string
  monoTextClass?: string
  children?: React.ReactNode
}) {
  if (emptyMessage) {
    return (
      <div className="flex flex-col flex-1 border border-dashed border-zinc-200 rounded-xl overflow-hidden bg-zinc-50/30 items-center justify-center text-zinc-400 text-xs italic">
        {emptyMessage}
      </div>
    )
  }
  return (
    <div className="flex flex-col flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
        <span className="text-xs font-semibold text-zinc-700 truncate">{title}</span>
        {badge && (
          <span className={`text-[10px] uppercase tracking-widest font-semibold ${badgeTone}`}>
            {badge}
          </span>
        )}
      </div>
      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-700">
          Error: {error}
        </div>
      )}
      <pre className={`flex-1 overflow-auto p-4 text-[13px] leading-[1.7] whitespace-pre-wrap font-mono ${monoTextClass}`}>
        {children}
      </pre>
    </div>
  )
}

/**
 * Overlay comparing a forked run with its source node by node (#130).
 */
export function ForkCompareOverlay({
  runId,
  initialComparison,
  onClose,
}: {
  runId: string
  initialComparison?: ForkComparison
  onClose: () => void
}) {
  const [data, setData] = useState<ForkComparison | null>(initialComparison ?? null)
  const [loading, setLoading] = useState(!initialComparison)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [highlightDiff, setHighlightDiff] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (initialComparison) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/runs/${encodeURIComponent(runId)}/comparison`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `Failed to load comparison (${res.status})`)
        }
        return res.json()
      })
      .then((comp: ForkComparison) => {
        if (!cancelled) {
          setData(comp)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [runId, initialComparison])

  const nodes = data?.nodes ?? []

  // Default selection: first regenerated node if available, otherwise first node (#130).
  const effectiveKey = selectedKey ?? (() => {
    const firstDiff = nodes.find(n => n.status === 'regenerated')
    return firstDiff ? nodeKey(firstDiff) : (nodes[0] ? nodeKey(nodes[0]) : null)
  })()

  const selectedNode = useMemo(
    () => nodes.find(n => nodeKey(n) === effectiveKey) ?? nodes[0] ?? null,
    [nodes, effectiveKey]
  )

  const diffModel = useMemo(() => {
    if (!selectedNode || !highlightDiff) return null
    if (selectedNode.status !== 'regenerated') return null
    return buildCompareModel([
      { name: 'source', text: selectedNode.sourceOutput ?? '' },
      { name: 'fork', text: selectedNode.forkOutput ?? '' },
    ])
  }, [selectedNode, highlightDiff])

  const { sourceSpans, forkSpans } = useMemo(() => {
    if (!diffModel?.columns[0]) return { sourceSpans: null, forkSpans: null }
    // #130: columns[0] diffs fork against source; cut spans are deletions from source, added are insertions into fork.
    const spans = diffModel.columns[0].spans
    return {
      sourceSpans: spans.filter(s => s.kind !== 'added'),
      forkSpans: spans.filter(s => s.kind !== 'cut'),
    }
  }, [diffModel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="compare with source"
      className="fixed inset-0 z-50 bg-white flex flex-col"
    >
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <GitCompare size={16} className="text-zinc-700" />
              <span className="text-sm font-semibold text-zinc-800">compare with source</span>
            </div>
            {data && (
              <span className="text-xs font-mono text-zinc-400">
                <span className="text-zinc-600 font-medium">{data.sourceRunId.slice(0, 12)}</span>
                {' ─► '}
                <span className="text-zinc-900 font-medium">{data.forkRunId.slice(0, 12)}</span>
              </span>
            )}
            {data?.warning && (
              <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                {data.warning}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={highlightDiff}
                onChange={e => setHighlightDiff(e.target.checked)}
                className="accent-zinc-900 cursor-pointer"
              />
              highlight diffs
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="close comparison"
              className="text-zinc-400 hover:text-zinc-900 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {nodes.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
            {nodes.map(n => {
              const key = nodeKey(n)
              const isSelected = key === effectiveKey
              const badge = STATUS_BADGE[n.status]
              const isReused = n.status === 'reused'

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all shrink-0 text-left ${
                    isSelected
                      ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
                      : isReused
                        ? 'border-zinc-200 bg-zinc-50/70 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <span className="font-medium truncate max-w-[10rem]">
                    {n.nodeName}
                    {n.round !== undefined ? ` (r${n.round + 1})` : ''}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-semibold ${
                      isSelected
                        ? 'bg-zinc-800 text-zinc-200 border-zinc-700'
                        : badge.tone
                    }`}
                  >
                    {badge.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
            <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
            <span className="text-xs uppercase tracking-wider font-medium">Loading fork comparison</span>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto p-6 text-center border border-red-200 bg-red-50 rounded-xl">
            <h3 className="text-sm font-semibold text-red-900 mb-1">Comparison unavailable</h3>
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {!loading && !error && data?.lineage === 'unavailable' && nodes.length === 0 && (
          <div className="max-w-md mx-auto p-6 text-center border border-amber-200 bg-amber-50 rounded-xl">
            <div className="flex items-center justify-center gap-1.5 text-amber-900 font-semibold mb-1">
              <AlertTriangle size={16} />
              <h3 className="text-sm">Lineage unavailable</h3>
            </div>
            <p className="text-xs text-amber-700">{data.warning ?? 'Source run baseline is unavailable'}</p>
          </div>
        )}

        {!loading && !error && selectedNode && (
          <div className="flex flex-col h-full gap-4">
            <div className="flex items-center justify-between text-xs text-zinc-500 border-b border-zinc-100 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-800">{selectedNode.nodeName}</span>
                {selectedNode.round !== undefined && <span>Round {selectedNode.round + 1}</span>}
                <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[selectedNode.status].tone}`}>
                  {STATUS_BADGE[selectedNode.status].label}
                </span>
              </div>
              {selectedNode.status === 'reused' && (
                <span className="text-zinc-400 italic">Replayed from source run without re-executing (unchanged)</span>
              )}
            </div>

            {selectedNode.status === 'reused' && (
              <DiffColumn
                title="Output (identical to source)"
                badge="replayed"
                monoTextClass="text-zinc-400"
              >
                {selectedNode.forkOutput ?? selectedNode.sourceOutput ?? ''}
              </DiffColumn>
            )}

            {selectedNode.status === 'regenerated' && (
              <div className="flex gap-4 items-stretch flex-1 min-h-[30rem]">
                <DiffColumn title="Source run" badge="baseline" error={selectedNode.sourceError}>
                  {sourceSpans ? (
                    sourceSpans.map((span, i) => (
                      <span key={i} className={SPAN_CLASS[span.kind]}>{span.text}</span>
                    ))
                  ) : (
                    selectedNode.sourceOutput ?? ''
                  )}
                </DiffColumn>

                <DiffColumn title="Forked run" badge="regenerated" error={selectedNode.forkError}>
                  {forkSpans ? (
                    forkSpans.map((span, i) => (
                      <span key={i} className={SPAN_CLASS[span.kind]}>{span.text}</span>
                    ))
                  ) : (
                    selectedNode.forkOutput ?? ''
                  )}
                </DiffColumn>
              </div>
            )}

            {selectedNode.status === 'added' && (
              <div className="flex gap-4 items-stretch flex-1 min-h-[30rem]">
                <DiffColumn emptyMessage="Not executed in source run" />
                <DiffColumn
                  title="Forked run"
                  badge="added"
                  badgeTone="text-emerald-600"
                  error={selectedNode.forkError}
                >
                  {selectedNode.forkOutput ?? ''}
                </DiffColumn>
              </div>
            )}

            {selectedNode.status === 'removed' && (
              <div className="flex gap-4 items-stretch flex-1 min-h-[30rem]">
                <DiffColumn
                  title="Source run"
                  badge="removed"
                  badgeTone="text-rose-600"
                  error={selectedNode.sourceError}
                >
                  {selectedNode.sourceOutput ?? ''}
                </DiffColumn>
                <DiffColumn emptyMessage="Not executed in forked run" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
