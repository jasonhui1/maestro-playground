'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import type { PanelFit } from '@/lib/panelFit'
import { PanelRow } from '@/components/result/PanelRow'
import { ReadingPane } from '@/components/result/ReadingPane'

// Panel width is not a volume signal (#65): panels share the row equally, and how much
// one holds reads from the index fit's volume rule instead.
export function Timeline({ panels, deck, fit }: {
  panels: LayoutPanel[]
  deck: PanelDeck
  fit: PanelFit
}) {
  const open = deck.open !== null ? panels[deck.open] : undefined

  return (
    <div className="flex flex-col gap-4">
      <PanelRow panels={panels} deck={deck} fit={fit} offsetOf={i => i} />
      {open && <ReadingPane panel={open} onClose={() => deck.openPanel(null)} />}
    </div>
  )
}
