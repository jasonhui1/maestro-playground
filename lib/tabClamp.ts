// lib/tabClamp.ts
export type PanelTab = 'output' | 'validation' | 'history'

export function clampTab(persisted: PanelTab, available: PanelTab[]): PanelTab {
  if (available.includes(persisted)) return persisted
  return available[0] ?? 'history'
}
