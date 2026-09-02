'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import type { PanelFit } from '@/lib/panelFit'
import { PanelRow } from '@/components/result/PanelRow'
import { ReadingPane } from '@/components/result/ReadingPane'

// Equal share of the row per hop — panel width is not a volume signal (Jason,
// 2026-09-01); the shrink across hops reads from the content, or from the index fit's
// volume rule, not from the frame.
export function Timeline({ panels, deck, fit = 'spread' }: {
  panels: LayoutPanel[]
  deck: PanelDeck
  fit?: PanelFit
}) {
  const open = deck.open !== null ? panels[deck.open] : undefined

  return (
    <div className="flex flex-col gap-4">
      <PanelRow panels={panels} deck={deck} fit={fit} offsetOf={i => i} />
      {open && <ReadingPane panel={open} onClose={() => deck.openPanel(null)} />}
    </div>
  )
}
