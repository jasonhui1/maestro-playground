'use client'
import Sidebar, { CategoryNavigation } from '@/components/workspace/Sidebar'
import { Suspense, useEffect, useRef } from 'react'
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const collapsed = useWorkspaceUiStore(s => s.sidebarCollapsed)
  const panelRef = useRef<PanelImperativeHandle>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (panel) {
      if (collapsed) {
        panel.collapse()
      } else {
        panel.expand()
      }
    }
  }, [collapsed])

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden flex flex-row bg-white">
      <CategoryNavigation />
      <div className="flex-1 h-full min-w-0">
        <Group orientation="horizontal">
          <Panel 
            panelRef={panelRef}
            defaultSize="20%" 
            minSize="15%" 
            maxSize="40%"
            collapsible={true}
            onResize={(size) => {
              if (size.asPercentage === 0) {
                useWorkspaceUiStore.setState({ sidebarCollapsed: true })
              } else {
                useWorkspaceUiStore.setState({ sidebarCollapsed: false })
              }
            }}
          >
            <Suspense fallback={<div className="h-full border-r border-zinc-200 bg-white p-4">Loading sidebar...</div>}>
              <Sidebar />
            </Suspense>
          </Panel>
          <Separator className="w-1 bg-zinc-100 hover:bg-zinc-200 transition-colors border-x border-zinc-200" />
          <Panel>
            <main className="h-full overflow-auto bg-white">{children}</main>
          </Panel>
        </Group>
      </div>
    </div>
  )
}
