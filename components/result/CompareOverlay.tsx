'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { compareOrder, type PanelDeck } from '@/lib/panelDeck'
import { buildCompareModel, buildSharedModel, COMPARE_MODES } from '@/lib/compareModel'
import type { CompareMode, SharedSpanKind, SpanKind } from '@/lib/compareModel'

const SPAN_CLASS: Record<SpanKind, string> = {
  same: '',
  cut: 'bg-red-100 text-red-900 line-through decoration-red-400',
  added: 'bg-green-100 text-green-900',
}

/** Shared text recedes and each panel's own words stand — the reverse of the base
 *  mode's marks, because here the agreement is the finding (#74). */
const SHARED_CLASS: Record<SharedSpanKind, string> = {
  shared: 'text-zinc-300',
  own: 'text-zinc-900 font-medium',
}

/** Both modes are the same column of marked text; only the marks differ. */
function Column<K extends string>({ name, spans, label, spanClass }: {
  name: string
  spans: { kind: K; text: string }[]
  label?: string
  spanClass: Record<K, string>
}) {
  return (
    <div className="flex flex-col min-w-[20rem] flex-1 border border-zinc-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50">
        <span className="text-xs font-semibold text-zinc-700 truncate">{name}</span>
        {label && <span className="text-[10px] uppercase tracking-widest text-zinc-400">{label}</span>}
      </div>
      <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed whitespace-pre-wrap font-sans text-zinc-800">
        {spans.map((span, i) => (
          <span key={i} className={spanClass[span.kind]}>{span.text}</span>
        ))}
      </pre>
    </div>
  )
}



const sourcesOf = (panels: LayoutPanel[], order: number[]) =>
  order.map(i => ({ name: panels[i].name, text: panels[i].text }))

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
  const enough = deck.selected.length >= 2
  // Only the mode on screen is built — an N-way alignment is not free, and a live run
  // re-renders this on every token.
  const model = mode === 'base' ? buildCompareModel(sourcesOf(panels, ordered)) : null
  // Shared mode reads the ticked panels as ticked — it has no base to lead with.
  const sharedModel = mode === 'shared' ? buildSharedModel(sourcesOf(panels, deck.selected)) : null

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
          {enough && mode === 'shared' && (
            <span className="text-xs text-zinc-400">
              <span className="text-zinc-300">dimmed</span> = every panel says it ·{' '}
              <span className="text-zinc-900 font-medium">bold</span> = only this one
            </span>
          )}
          {enough && mode === 'base' && (
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
        {enough ? (
          <div className="flex gap-4 items-stretch min-h-full">
            {sharedModel?.columns.map((column, i) => (
              <Column key={i} {...column} spanClass={SHARED_CLASS} />
            ))}
            {model && <Column {...model.base} label="base" spanClass={SPAN_CLASS} />}
            {model?.columns.map((column, i) => (
              <Column key={i} {...column} spanClass={SPAN_CLASS} />
            ))}
          </div>
        ) : (
          <span className="text-sm text-zinc-400 italic">tick a second panel above to compare them</span>
        )}
      </div>
    </div>
  )
}
