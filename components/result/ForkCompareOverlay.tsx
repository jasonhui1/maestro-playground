'use client'
import { useEffect, useState, useMemo } from 'react'
import { X, GitCompare, RefreshCw, CheckCircle2, PlusCircle, MinusCircle } from 'lucide-react'
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

/**
 * Overlay comparing a forked run with its source node by node (#130).
 * Replayed nodes are greyed out; regenerated nodes display a side-by-side diff.
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
    if (selectedNode.status === 'reused' || selectedNode.status === 'added' || selectedNode.status === 'removed') return null
    const sourceText = selectedNode.sourceOutput ?? ''
    const forkText = selectedNode.forkOutput ?? ''
    return buildCompareModel([
      { name: 'source', text: sourceText },
      { name: 'fork', text: forkText },
    ])
  }, [selectedNode, highlightDiff])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="compare with source"
      className="fixed inset-0 z-50 bg-white flex flex-col"
    >
      {/* Top bar: title, run lineage, options, and close */}
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

        {/* Node selector strip: replayed nodes greyed out, diff nodes accented (#130) */}
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

      {/* Main content body */}
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

        {!loading && !error && selectedNode && (
          <div className="flex flex-col h-full gap-4">
            {/* Context bar for the selected node */}
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

            {/* Reused: greyed out text view */}
            {selectedNode.status === 'reused' && (
              <div className="flex flex-col flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-zinc-50/40">
                <div className="px-4 py-2 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-500">Output (identical to source)</span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400">replayed</span>
                </div>
                <pre className="flex-1 overflow-auto p-4 text-[13px] leading-[1.7] whitespace-pre-wrap font-mono text-zinc-400">
                  {selectedNode.forkOutput ?? selectedNode.sourceOutput ?? ''}
                </pre>
              </div>
            )}

            {/* Regenerated: side-by-side diff */}
            {selectedNode.status === 'regenerated' && (
              <div className="flex gap-4 items-stretch flex-1 min-h-[30rem]">
                {/* Source column */}
                <div className="flex flex-col flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
                  <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
                    <span className="text-xs font-semibold text-zinc-700 truncate">Source run</span>
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400">baseline</span>
                  </div>
                  {selectedNode.sourceError && (
                    <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-700">
                      Error: {selectedNode.sourceError}
                    </div>
                  )}
                  <pre className="flex-1 overflow-auto p-4 text-[13px] leading-[1.7] whitespace-pre-wrap font-mono text-zinc-800">
                    {diffModel ? (
                      diffModel.base.spans.map((span, i) => (
                        <span key={i} className={SPAN_CLASS[span.kind]}>{span.text}</span>
                      ))
                    ) : (
                      selectedNode.sourceOutput ?? ''
                    )}
                  </pre>
                </div>

                {/* Fork column */}
                <div className="flex flex-col flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
                  <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
                    <span className="text-xs font-semibold text-zinc-700 truncate">Forked run</span>
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400">regenerated</span>
                  </div>
                  {selectedNode.forkError && (
                    <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-700">
                      Error: {selectedNode.forkError}
                    </div>
                  )}
                  <pre className="flex-1 overflow-auto p-4 text-[13px] leading-[1.7] whitespace-pre-wrap font-mono text-zinc-800">
                    {diffModel?.columns[0] ? (
                      diffModel.columns[0].spans.map((span, i) => (
                        <span key={i} className={SPAN_CLASS[span.kind]}>{span.text}</span>
                      ))
                    ) : (
                      selectedNode.forkOutput ?? ''
                    )}
                  </pre>
                </div>
              </div>
            )}

            {/* Added: present only in fork */}
            {selectedNode.status === 'added' && (
              <div className="flex gap-4 items-stretch flex-1 min-h-[30rem]">
                <div className="flex flex-col flex-1 border border-dashed border-zinc-200 rounded-xl overflow-hidden bg-zinc-50/30 items-center justify-center text-zinc-400 text-xs italic">
                  Not executed in source run
                </div>
                <div className="flex flex-col flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
                  <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
                    <span className="text-xs font-semibold text-zinc-700 truncate">Forked run</span>
                    <span className="text-[10px] uppercase tracking-widest text-emerald-600">added</span>
                  </div>
                  <pre className="flex-1 overflow-auto p-4 text-[13px] leading-[1.7] whitespace-pre-wrap font-mono text-zinc-800">
                    {selectedNode.forkOutput ?? ''}
                  </pre>
                </div>
              </div>
            )}

            {/* Removed: present only in source */}
            {selectedNode.status === 'removed' && (
              <div className="flex gap-4 items-stretch flex-1 min-h-[30rem]">
                <div className="flex flex-col flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
                  <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
                    <span className="text-xs font-semibold text-zinc-700 truncate">Source run</span>
                    <span className="text-[10px] uppercase tracking-widest text-rose-600">removed</span>
                  </div>
                  <pre className="flex-1 overflow-auto p-4 text-[13px] leading-[1.7] whitespace-pre-wrap font-mono text-zinc-800">
                    {selectedNode.sourceOutput ?? ''}
                  </pre>
                </div>
                <div className="flex flex-col flex-1 border border-dashed border-zinc-200 rounded-xl overflow-hidden bg-zinc-50/30 items-center justify-center text-zinc-400 text-xs italic">
                  Not executed in forked run
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
