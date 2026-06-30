// hooks/store/useWorkspaceUiStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PanelTab } from '../../lib/tabClamp'

export type DockSide = 'bottom' | 'right'
export type EntityType = 'agent' | 'skill' | 'chain' | 'template' | 'context'

interface WorkspaceUiStore {
  dockSide: DockSide
  panelCollapsed: boolean
  panelSize: number
  activeTab: PanelTab
  sidebarCollapsed: boolean
  paletteCollapsed: boolean
  activeCategory: EntityType
  setDockSide: (s: DockSide) => void
  togglePanel: () => void
  setPanelSize: (px: number) => void
  setActiveTab: (t: PanelTab) => void
  toggleSidebar: () => void
  togglePalette: () => void
  setActiveCategory: (cat: EntityType) => void
}

export const useWorkspaceUiStore = create<WorkspaceUiStore>()(
  persist(
    (set) => ({
      dockSide: 'bottom',
      panelCollapsed: false,
      panelSize: 30, // percent of the editor area (the parent react-resizable Panel owns sizing)
      activeTab: 'output',
      sidebarCollapsed: false,
      paletteCollapsed: false,
      activeCategory: 'agent',
      setDockSide: (s) => set({ dockSide: s }),
      togglePanel: () => set((st) => ({ panelCollapsed: !st.panelCollapsed })),
      setPanelSize: (n) => set({ panelSize: Math.max(10, Math.min(80, n)) }),
      setActiveTab: (t) => set({ activeTab: t }),
      toggleSidebar: () => set((st) => ({ sidebarCollapsed: !st.sidebarCollapsed })),
      togglePalette: () => set((st) => ({ paletteCollapsed: !st.paletteCollapsed })),
      setActiveCategory: (cat) => set({ activeCategory: cat }),
    }),
    { name: 'maestro_workspace_ui' },
  ),
)
