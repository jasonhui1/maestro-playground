'use client'
import Sidebar from '@/components/workspace/Sidebar'
import { Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { PanelLeftOpen } from 'lucide-react'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const collapsed = useWorkspaceUiStore(s => s.sidebarCollapsed)
  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden">
      <Group orientation="horizontal">
        {collapsed ? (
          <div className="w-9 h-full border-r border-zinc-200 bg-white flex flex-col items-center py-3">
            <button onClick={() => useWorkspaceUiStore.getState().toggleSidebar()} className="text-zinc-500 hover:text-zinc-900" aria-label="Open sidebar">
              <PanelLeftOpen size={18} />
            </button>
          </div>
        ) : (
          <>
            <Panel defaultSize="20%" minSize="15%" maxSize="40%">
              <Suspense fallback={<div className="h-full border-r border-zinc-200 bg-white p-4">Loading sidebar...</div>}>
                <Sidebar />
              </Suspense>
            </Panel>
            <Separator className="w-1 bg-zinc-100 hover:bg-zinc-200 transition-colors border-x border-zinc-200" />
          </>
        )}
        <Panel>
          <main className="h-full overflow-auto bg-white">{children}</main>
        </Panel>
      </Group>
    </div>
  )
}
