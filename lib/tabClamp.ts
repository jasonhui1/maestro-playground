// lib/tabClamp.ts
// One persisted tab cell serves every dock; clampTab drops a tab the current
// surface doesn't offer, so run tabs and workspace tabs can share it (#64).
export type PanelTab = 'output' | 'validation' | 'history' | 'trace' | 'compare' | 'versions'

export function clampTab(persisted: PanelTab, available: PanelTab[]): PanelTab {
  if (available.includes(persisted)) return persisted
  return available[0] ?? 'history'
}
