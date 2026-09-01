'use client'
import { useState, type ReactNode } from 'react'
import type { LayoutModel } from '@/lib/layoutModel'
import type { RunFrameModel } from '@/lib/runFrame'
import type { PanelDeck } from '@/lib/panelDeck'
import { RunFrame } from '@/components/result/RunFrame'
import { Timeline } from '@/components/result/Timeline'
import { Columns } from '@/components/result/Columns'
import { Sidebar } from '@/components/result/Sidebar'
import { CompareOverlay } from '@/components/result/CompareOverlay'

/** The one place a `LayoutModel.kind` picks its renderer — the live result page and a
 *  run reopened from history (#72) share this instead of each switching on it. The
 *  compare overlay is mounted here rather than per layout, so every layout gets it
 *  from the same selection (#71). */
export function LayoutModelView({ model, frame, runId, deck, fallback }: {
  model: LayoutModel
  frame: RunFrameModel
  runId?: string | null
  deck: PanelDeck
  /** What renders for `kind: 'undeclared'`; omit where the caller never reaches it. */
  fallback?: ReactNode
}) {
  const [comparing, setComparing] = useState(false)

  return (
    <RunFrame
      frame={frame}
      runId={runId}
      selectedCount={deck.selected.length}
      onCompare={() => setComparing(true)}
    >
      {model.kind === 'timeline' && <Timeline panels={model.panels} deck={deck} />}
      {model.kind === 'columns' && <Columns panels={model.panels} deck={deck} />}
      {model.kind === 'sidebar' && <Sidebar panels={model.panels} deck={deck} />}
      {model.kind === 'undeclared' && fallback}
      {comparing && (
        <CompareOverlay panels={model.panels} deck={deck} onClose={() => setComparing(false)} />
      )}
    </RunFrame>
  )
}
