'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import type { PanelFit } from '@/lib/panelFit'
import type { RunStatus } from '@/lib/runFrame'
import { PanelRow } from '@/components/result/PanelRow'
import { ReadingPane } from '@/components/result/ReadingPane'

/** Branch panels as equal-width columns; `role: join` panels as a full-width row beneath (#67). */
export function Columns({ panels, deck, fit, status }: {
  panels: LayoutPanel[]
  deck: PanelDeck
  fit: PanelFit
  status: RunStatus
}) {
  const branchIdx = panels.map((panel, i) => ({ panel, i })).filter(({ panel }) => panel.emphasis !== 'join')
  const joinIdx = panels.map((panel, i) => ({ panel, i })).filter(({ panel }) => panel.emphasis === 'join')
  const open = deck.open !== null ? panels[deck.open] : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* A chain whose every port is `role: join` leaves no branches — the joins render
          alone rather than the row emitting an empty track list. */}
      {branchIdx.length > 0 && (
        <PanelRow
          panels={branchIdx.map(b => b.panel)}
          deck={deck}
          fit={fit} status={status}

          offsetOf={i => branchIdx[i].i}
        />
      )}
      {joinIdx.length > 0 && (
        <div className="border-t border-zinc-200 pt-4">
          <PanelRow
            panels={joinIdx.map(j => j.panel)}
            deck={deck}
            fit={fit} status={status}

            offsetOf={i => joinIdx[i].i}
          />
        </div>
      )}
      {open && <ReadingPane panel={open} status={status} onClose={() => deck.openPanel(null)} />}
    </div>
  )
}
