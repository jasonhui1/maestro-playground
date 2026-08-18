'use client'
import React, { useEffect } from 'react'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { clampTab, type PanelTab } from '@/lib/tabClamp'
import { useRunStore } from '@/hooks/store/useRunStore'
import type { ValidationIssue } from '@/lib/types'
import OutputTab from './OutputTab'
import InstanceSwitcher from './InstanceSwitcher'
import ValidationPanel from '@/components/editor/ValidationPanel'
import { HistoryPane } from './HistoryPane'
import DockShell from './DockShell'

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

  const tabs = available.map(t => ({
    id: t,
    label: t === 'validation' ? `${t} ${issues.length > 0 ? issues.length : '✓'}` : t,
  }))

  return (
    <DockShell
      tabs={tabs}
      active={active}
      actions={
        <InstanceSwitcher count={instanceCount} index={currentInstance}
          onChange={(i) => useRunStore.getState().setCurrentInstance(fileKey, i)} />
      }
      banner={error && (
        <div className="px-3 py-1.5 text-[11px] text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}
    >
      {active === 'output' && <OutputTab fileKey={fileKey} view={view === 'none' ? 'agent' : view} />}
      {active === 'validation' && <ValidationPanel issues={issues} onSelect={onSelectIssueNode} />}
      {active === 'history' && <HistoryPane entityType={type} slug={slug} onClose={ui.togglePanel} />}
    </DockShell>
  )
}
