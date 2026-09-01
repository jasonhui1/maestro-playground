'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import { ReadingPane } from '@/components/result/ReadingPane'

// A vertical list, not a row: N iterations scroll down rather than forcing the
// horizontal scroll the rejected stacked-cards shape had (#68). The detail pane is
// the same `ReadingPane` every other layout opens a panel into (#73) — sidebar just
// keeps the list on screen beside it instead of beneath it.
export function Sidebar({ panels, deck }: { panels: LayoutPanel[]; deck: PanelDeck }) {
  const open = deck.open !== null ? panels[deck.open] : undefined

  return (
    <div className="flex gap-4 items-start">
      <div className="flex flex-col gap-1 w-48 shrink-0 max-h-[32rem] overflow-y-auto">
        {panels.map((panel, i) => (
          <div
            key={`${panel.name}-${i}`}
            onClick={() => deck.openPanel(deck.open === i ? null : i)}
            role="button"
            aria-pressed={deck.open === i}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors ${
              deck.open === i ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            <input
              type="checkbox"
              checked={deck.selected.includes(i)}
              onClick={e => e.stopPropagation()}
              onChange={() => deck.toggleSelect(i)}
              aria-label={`select ${panel.name} for compare`}
              className="accent-zinc-900 cursor-pointer"
            />
            <span className="truncate">{panel.name}</span>
          </div>
        ))}
        {panels.length === 0 && (
          <span className="text-xs text-zinc-400 italic px-2 py-1.5">waiting for the first round</span>
        )}
      </div>

      {open ? (
        <div className="flex-1 min-w-0">
          <ReadingPane panel={open} onClose={() => deck.openPanel(null)} />
        </div>
      ) : (
        <div className="flex-1 min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/60 p-5">
          <span className="text-xs text-zinc-400 italic">select an iteration to read it</span>
        </div>
      )}
    </div>
  )
}
