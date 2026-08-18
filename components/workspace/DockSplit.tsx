'use client'
import React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'

/**
 * Main region over a docked panel, sized and sided from the persisted UI store.
 * Collapsed, the dock is a fixed strip rather than a panel, so the main region
 * keeps every pixel the strip doesn't need.
 */
export default function DockSplit({ main, dock }: { main: React.ReactNode; dock: React.ReactNode }) {
  const dockSide = useWorkspaceUiStore(s => s.dockSide)
  const panelCollapsed = useWorkspaceUiStore(s => s.panelCollapsed)
  const panelSize = useWorkspaceUiStore(s => s.panelSize)

  if (panelCollapsed) {
    return (
      <div className={`h-full flex ${dockSide === 'right' ? 'flex-row' : 'flex-col'}`}>
        <div className="flex-1 min-w-0 min-h-0">{main}</div>
        {dock}
      </div>
    )
  }

  return (
    <Group orientation={dockSide === 'right' ? 'horizontal' : 'vertical'}>
      <Panel minSize="30%">
        <div className="h-full min-h-0">{main}</div>
      </Panel>
      <Separator className={`bg-zinc-100 hover:bg-zinc-200 transition-colors ${dockSide === 'right' ? 'w-1 border-x' : 'h-1 border-y'} border-zinc-200`} />
      <Panel defaultSize={`${panelSize}%`} minSize="10%"
        onResize={(size) => useWorkspaceUiStore.getState().setPanelSize(size as unknown as number)}>
        {dock}
      </Panel>
    </Group>
  )
}
