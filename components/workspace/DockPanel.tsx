'use client'
import React, { useEffect } from 'react'
import { PanelBottom, PanelRight, ChevronDown, ChevronUp } from 'lucide-react'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { clampTab, type PanelTab } from '@/lib/tabClamp'
import { useRunStore } from '@/hooks/store/useRunStore'
import type { ValidationIssue } from '@/lib/types'
import OutputTab from './OutputTab'
import InstanceSwitcher from './InstanceSwitcher'
import ValidationPanel from '@/components/editor/ValidationPanel'
import { HistoryPane } from './HistoryPane'

type View = 'graph' | 'yaml' | 'agent' | 'none'

const tabsForView: Record<View, PanelTab[]> = {
  graph: ['output', 'validation', 'history'],
  yaml: ['output', 'validation', 'history'],
  agent: ['output', 'history'],
  none: ['history'],
}

export default function DockPanel({ type, slug, view, issues, onSelectIssueNode }: {
  type: string; slug: string; view: View; issues: ValidationIssue[]; onSelectIssueNode: (id: string | null) => void
}) {
  const fileKey = `${type}:${slug}`
  const ui = useWorkspaceUiStore()
  const available = tabsForView[view]
  const active = clampTab(ui.activeTab, available)

  const file = useRunStore(s => s.byFile[fileKey])
  const error = file?.error ?? null
  const instanceCount = file?.instanceCount ?? 0
  const currentInstance = file?.currentInstance ?? 0

  // a3: run-level error auto-switches to Validation (when available)
  useEffect(() => {
    if (error && available.includes('validation')) useWorkspaceUiStore.getState().setActiveTab('validation')
  }, [error, available])

  const isRight = ui.dockSide === 'right'
  // Size is owned by the parent react-resizable Panel (Task C4/C5); DockPanel just fills it.
  const containerCls = isRight
    ? 'border-l border-zinc-200 h-full flex flex-col'
    : 'border-t border-zinc-200 w-full flex flex-col'

  if (ui.panelCollapsed) {
    return (
      <div className={`${isRight ? 'border-l h-full w-9' : 'border-t w-full h-9'} border-zinc-200 bg-white flex items-center gap-2 px-2`}>
        <button onClick={ui.togglePanel} className="text-zinc-500 hover:text-zinc-900" aria-label="Expand panel">
          {isRight ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{active}</span>
      </div>
    )
  }

  return (
    <div className={`${containerCls} h-full bg-white`}>
      {/* header: tabs + instance switcher + dock/collapse controls */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 bg-white">
        {available.map(t => (
          <button key={t} onClick={() => useWorkspaceUiStore.getState().setActiveTab(t)}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${active === t ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'}`}>
            {t}{t === 'validation' && issues.length > 0 ? ` ${issues.length}` : ''}{t === 'validation' && issues.length === 0 ? ' ✓' : ''}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <InstanceSwitcher count={instanceCount} index={currentInstance}
            onChange={(i) => useRunStore.getState().setCurrentInstance(fileKey, i)} />
          <button onClick={() => ui.setDockSide(isRight ? 'bottom' : 'right')} className="text-zinc-400 hover:text-zinc-900" aria-label="Flip dock side">
            {isRight ? <PanelBottom size={14} /> : <PanelRight size={14} />}
          </button>
          <button onClick={ui.togglePanel} className="text-zinc-400 hover:text-zinc-900" aria-label="Collapse panel">
            {isRight ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {active === 'output' && <OutputTab fileKey={fileKey} view={view === 'none' ? 'agent' : view} />}
        {active === 'validation' && <ValidationPanel issues={issues} onSelect={onSelectIssueNode} />}
        {active === 'history' && <HistoryPane entityType={type} slug={slug} onClose={ui.togglePanel} />}
      </div>
    </div>
  )
}
