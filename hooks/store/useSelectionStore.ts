// hooks/store/useSelectionStore.ts
import { create } from 'zustand'

interface SelectionStore {
  byFile: Record<string, string | null>
  setSelected: (key: string, nodeId: string | null) => void
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  byFile: {},
  setSelected: (key, nodeId) => set((s) => ({ byFile: { ...s.byFile, [key]: nodeId } })),
}))

export function selectedNodeId(key: string): string | null {
  return useSelectionStore.getState().byFile[key] ?? null
}
