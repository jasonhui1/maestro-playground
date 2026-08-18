'use client'
import React from 'react'
import { PanelBottom, PanelRight, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import type { PanelTab } from '@/lib/tabClamp'

/**
 * The dock's chrome: collapsed strip, tab row, side/collapse controls. Size is
 * owned by the enclosing DockSplit panel; this just fills it.
 */
export default function DockShell({ tabs, active, actions, banner, children }: {
  tabs: { id: PanelTab; label: string }[]
  active: PanelTab
  actions?: React.ReactNode
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  const ui = useWorkspaceUiStore()
  const isRight = ui.dockSide === 'right'

  if (ui.panelCollapsed) {
    return (
      <div className={`${isRight ? 'border-l h-full w-9 flex-col py-4 items-center gap-4' : 'border-t w-full h-9 items-center gap-2 px-2'} border-zinc-200 bg-white flex`}>
        <button onClick={ui.togglePanel} className="text-zinc-500 hover:text-zinc-900" aria-label="Expand panel">
          {isRight ? <ChevronLeft size={16} /> : <ChevronUp size={16} />}
        </button>
        <span className={`text-[10px] font-bold text-zinc-400 uppercase tracking-widest ${isRight ? '[writing-mode:vertical-lr] rotate-180' : ''}`}>{active}</span>
      </div>
    )
  }

  return (
    <div className={`${isRight ? 'border-l border-zinc-200' : 'border-t border-zinc-200'} h-full w-full flex flex-col bg-white`}>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 bg-white">
        {tabs.map(t => (
          <button key={t.id} onClick={() => useWorkspaceUiStore.getState().setActiveTab(t.id)}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${active === t.id ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <button onClick={() => ui.setDockSide(isRight ? 'bottom' : 'right')} className="text-zinc-400 hover:text-zinc-900" aria-label="Flip dock side">
            {isRight ? <PanelBottom size={14} /> : <PanelRight size={14} />}
          </button>
          <button onClick={ui.togglePanel} className="text-zinc-400 hover:text-zinc-900" aria-label="Collapse panel">
            {isRight ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {banner}

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
