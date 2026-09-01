'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import { Panel } from '@/components/result/Panel'
import { ReadingPane } from '@/components/result/ReadingPane'

// Panels share the row by content volume, so the shrink across hops is the picture
// rather than a caption on it (ADR-0015). Growth factors rather than widths: they
// divide whatever the row has, so no panel count or line count overflows it.
const growOf = (panel: LayoutPanel) => Math.max(panel.lines, 1)

export function Timeline({ panels, deck }: { panels: LayoutPanel[]; deck: PanelDeck }) {
  const open = deck.open !== null ? panels[deck.open] : undefined
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3 items-stretch overflow-x-auto pb-2">
        {panels.map((panel, i) => (
          <Panel
            key={`${panel.name}-${i}`}
            panel={panel}
            open={deck.open === i}
            selected={deck.selected.includes(i)}
            onOpen={() => deck.openPanel(deck.open === i ? null : i)}
            onToggleSelect={() => deck.toggleSelect(i)}
            style={{ flex: `${growOf(panel)} 1 0%` }}
            className="min-w-[9rem]"
          />
        ))}
      </div>
      {open && <ReadingPane panel={open} onClose={() => deck.openPanel(null)} />}
    </div>
  )
}
