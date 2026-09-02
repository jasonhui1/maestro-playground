'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import { leadLineOf } from '@/lib/panelDeck'

/**
 * A panel as an entry in an index rather than a column of prose: its name, the line it
 * opens with, and how much it says. Reading happens in the pane below at full measure,
 * so the entry stays legible whether the chain declared three panels or fifteen.
 */
export function PanelIndex({ panel, open, selected, share, onOpen, onToggleSelect }: {
  panel: LayoutPanel
  open: boolean
  selected: boolean
  /** This panel's volume against the largest in the set, 0–1. */
  share: number
  onOpen: () => void
  onToggleSelect: () => void
}) {
  const emphasised = panel.emphasis !== undefined
  const lead = panel.state === 'filled' ? leadLineOf(panel.text) : ''

  return (
    <div
      className={`relative group flex flex-col gap-2 py-3 px-3 -mx-px border-l transition-colors
        ${open ? 'border-l-zinc-900 bg-zinc-50' : 'border-l-zinc-200 hover:bg-zinc-50/70'}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`${open ? 'close' : 'open'} ${panel.name}`}
        className="absolute inset-0 z-0 cursor-pointer outline-none rounded
          focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-inset"
      />
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`select ${panel.name} for compare`}
        className="absolute top-3 right-2 z-20 accent-zinc-900 cursor-pointer opacity-0
          group-hover:opacity-100 focus-visible:opacity-100 checked:opacity-100
          focus-visible:ring-2 focus-visible:ring-zinc-900"
      />

      <div className="relative z-10 flex flex-col gap-2 pointer-events-none pr-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[11px] uppercase tracking-[0.14em]
            ${emphasised || open ? 'text-zinc-900 font-semibold' : 'text-zinc-400 font-medium'}`}>
            {panel.name}
          </span>
        </div>

        {panel.state === 'filled' && (
          <>
            <span className={`text-[13px] font-mono leading-snug line-clamp-3
              ${open ? 'text-zinc-900' : 'text-zinc-600'}`}>
              {lead}
            </span>
            {/* Volume against the widest panel — the shrink or spread across a chain
                reads here, where equal panel widths cannot carry it. */}
            <div className="flex items-center gap-2 mt-auto pt-1">
              <div className="h-px flex-1 bg-zinc-200">
                <div
                  className={`h-px ${emphasised || open ? 'bg-zinc-900' : 'bg-zinc-400'}`}
                  style={{ width: `${Math.max(share * 100, 4)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-zinc-400 shrink-0">{panel.lines} ln</span>
            </div>
          </>
        )}
        {panel.state === 'pending' && <span className="text-xs text-zinc-300 italic">waiting</span>}
        {panel.state === 'empty' && (
          <span className="text-xs text-amber-600 leading-snug">
            nothing survived — this hop dropped the section the chain asked it for
          </span>
        )}
      </div>
    </div>
  )
}
