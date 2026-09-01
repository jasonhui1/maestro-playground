'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import { Panel } from '@/components/result/Panel'
import { ReadingPane } from '@/components/result/ReadingPane'

/** Branch panels as equal-width columns; `role: join` panels as a full-width row beneath (#67). */
export function Columns({ panels, deck }: { panels: LayoutPanel[]; deck: PanelDeck }) {
  const branches = panels.map((panel, i) => ({ panel, i })).filter(({ panel }) => panel.emphasis !== 'join')
  const joins = panels.map((panel, i) => ({ panel, i })).filter(({ panel }) => panel.emphasis === 'join')
  const open = deck.open !== null ? panels[deck.open] : undefined

  const renderPanel = (panel: LayoutPanel, i: number, className?: string) => (
    <Panel
      key={`${panel.name}-${i}`}
      panel={panel}
      open={deck.open === i}
      selected={deck.selected.includes(i)}
      onOpen={() => deck.openPanel(deck.open === i ? null : i)}
      onToggleSelect={() => deck.toggleSelect(i)}
      className={className}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(0, 1fr))` }}>
        {branches.map(({ panel, i }) => renderPanel(panel, i))}
      </div>
      {joins.length > 0 && (
        <div className="flex flex-col gap-3">
          {joins.map(({ panel, i }) => renderPanel(panel, i, 'w-full'))}
        </div>
      )}
      {open && <ReadingPane panel={open} onClose={() => deck.openPanel(null)} />}
    </div>
  )
}
