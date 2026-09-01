'use client'
import type { ReactNode } from 'react'
import type { LayoutModel } from '@/lib/layoutModel'
import type { RunFrameModel } from '@/lib/runFrame'
import type { PanelDeck } from '@/lib/panelDeck'
import { RunFrame } from '@/components/result/RunFrame'
import { Timeline } from '@/components/result/Timeline'
import { Columns } from '@/components/result/Columns'
import { Sidebar } from '@/components/result/Sidebar'

/** The one place a `LayoutModel.kind` picks its renderer — the live result page and a
 *  run reopened from history (#72) share this instead of each switching on it. */
export function LayoutModelView({ model, frame, runId, deck, onCompare, fallback }: {
  model: LayoutModel
  frame: RunFrameModel
  runId?: string | null
  deck: PanelDeck
  onCompare?: () => void
  /** What renders for `kind: 'undeclared'`; omit where the caller never reaches it. */
  fallback?: ReactNode
}) {
  return (
    <RunFrame frame={frame} runId={runId} selectedCount={deck.selected.length} onCompare={onCompare}>
      {model.kind === 'timeline' && <Timeline panels={model.panels} deck={deck} />}
      {model.kind === 'columns' && <Columns panels={model.panels} deck={deck} />}
      {model.kind === 'sidebar' && <Sidebar panels={model.panels} deck={deck} />}
      {model.kind === 'undeclared' && fallback}
    </RunFrame>
  )
}
