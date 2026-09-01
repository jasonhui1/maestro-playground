'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { compareOrder, type PanelDeck } from '@/lib/panelDeck'
import { buildCompareModel, COMPARE_MODES } from '@/lib/compareModel'
import type { CompareColumn, CompareMode, SpanKind } from '@/lib/compareModel'

const SPAN_CLASS: Record<SpanKind, string> = {
  same: '',
  cut: 'bg-red-100 text-red-900 line-through decoration-red-400',
  added: 'bg-green-100 text-green-900',
}

function Column({ column, isBase }: { column: CompareColumn; isBase: boolean }) {
  return (
    <div className="flex flex-col min-w-[20rem] flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
        <span className="text-xs font-semibold text-zinc-700 truncate">{column.name}</span>
        {isBase && <span className="text-[10px] uppercase tracking-widest text-zinc-400">base</span>}
      </div>
      <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed whitespace-pre-wrap font-sans text-zinc-800">
        {column.spans.map((span, i) => (
          <span key={i} className={SPAN_CLASS[span.kind]}>{span.text}</span>
        ))}
      </pre>
    </div>
  )
}

/** The compare view (#71): a full-screen overlay reading `LayoutPanel`s and nothing
 *  else about the run, so every layout mounts it unchanged. */
export function CompareOverlay({ panels, deck, onClose }: {
  panels: LayoutPanel[]
  deck: PanelDeck
  onClose: () => void
}) {
  const [mode, setMode] = useState<CompareMode>('base')
  const [baseIndex, setBaseIndex] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ordered = compareOrder(deck.selected, baseIndex)
  const base = ordered[0]
  const model = buildCompareModel(ordered.map(i => ({ name: panels[i].name, text: panels[i].text })))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="compare"
      className="fixed inset-0 z-50 bg-white flex flex-col"
    >
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-800 mr-2">compare</span>
            {COMPARE_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                disabled={!m.enabled}
                aria-pressed={mode === m.id}
                className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40
                  ${mode === m.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="close compare" className="text-zinc-400 hover:text-zinc-900">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {panels.map((panel, i) => (
              <label key={`${panel.name}-${i}`} className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deck.selected.includes(i)}
                  onChange={() => deck.toggleSelect(i)}
                  aria-label={`compare ${panel.name}`}
                  className="accent-zinc-900 cursor-pointer"
                />
                {panel.name}
              </label>
            ))}
          </div>
          {model && (
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            base:
            <select
              value={base ?? ''}
              onChange={e => setBaseIndex(Number(e.target.value))}
              aria-label="base panel"
              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-800 outline-none focus:ring-2 focus:ring-zinc-900"
            >
              {deck.selected.map(i => <option key={i} value={i}>{panels[i].name}</option>)}
            </select>
          </label>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {model ? (
          <div className="flex gap-4 items-stretch min-h-full">
            <Column column={model.base} isBase />
            {model.columns.map((column, i) => <Column key={i} column={column} isBase={false} />)}
          </div>
        ) : (
          <span className="text-sm text-zinc-400 italic">tick a second panel above to compare it against the base</span>
        )}
      </div>
    </div>
  )
}
