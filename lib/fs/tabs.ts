import { WorkspaceTab, WorkspaceTabType } from '../types'

export const MAX_TABS = 15

export function tabKey(tab: { type: string; slug: string } | string): string {
  if (typeof tab === 'string') return tab
  return `${tab.type}:${tab.slug}`
}

/**
 * Parses the 'tabs' query parameter into an array of WorkspaceTab objects.
 * Format: type:slug,type:slug (e.g., agent:dm,chain:story)
 */
export function parseTabs(
  tabsParam: string | null, 
  activeType: string | null, 
  activeSlug: string | null
): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = []
  
  if (tabsParam) {
    const tabPairs = tabsParam.split(',')
    tabPairs.forEach(pair => {
      const [type, slug] = pair.split(':')
      if (type && slug) {
        tabs.push({
          type: type as WorkspaceTabType,
          slug,
          active: type === activeType && slug === activeSlug
        })
      }
    })
  }

  // Ensure active tab is in the list if it's not already
  if (activeType && activeSlug) {
    const activeExists = tabs.some(t => t.type === activeType && t.slug === activeSlug)
    if (!activeExists) {
      tabs.push({
        type: activeType as WorkspaceTabType,
        slug: activeSlug,
        active: true
      })
    } else if (!tabs.find(t => t.active)) {
      // If active tab exists but isn't marked active (shouldn't happen with logic above but for safety)
      const tab = tabs.find(t => t.type === activeType && t.slug === activeSlug)
      if (tab) tab.active = true
    }
  }

  return tabs
}

/**
 * Serializes an array of WorkspaceTab objects into a string for the 'tabs' query parameter.
 */
export function serializeTabs(tabs: WorkspaceTab[]): string {
  return tabs.map(tab => `${tab.type}:${tab.slug}`).join(',')
}

export function openTab(
  tabs: WorkspaceTab[],
  target: WorkspaceTab | { type: WorkspaceTabType; slug: string; active?: boolean }
): { tabs: WorkspaceTab[]; active: string } {
  const key = tabKey(target)
  const exists = tabs.some(t => tabKey(t) === key)

  if (exists) {
    const nextTabs = tabs.map(t => ({
      ...t,
      active: tabKey(t) === key,
    }))
    return { tabs: nextTabs, active: key }
  }

  const nextTabs = tabs.map(t => ({ ...t, active: false }))
  while (nextTabs.length >= MAX_TABS) {
    nextTabs.shift()
  }
  nextTabs.push({
    type: target.type,
    slug: target.slug,
    active: true,
  })

  return { tabs: nextTabs, active: key }
}

// #124 Successor on close: next tab at index, or previous if at end of list.
export function closeTab(
  tabs: WorkspaceTab[],
  activeTab: string | { type: string; slug: string } | null,
  targetKey: string | { type: string; slug: string }
): { tabs: WorkspaceTab[]; active: string | null } {
  const key = tabKey(targetKey)
  const active = activeTab ? tabKey(activeTab) : null
  const closedIndex = tabs.findIndex(t => tabKey(t) === key)
  if (closedIndex === -1) {
    return { tabs: [...tabs], active }
  }

  const wasActive = active !== null ? key === active : Boolean(tabs[closedIndex].active)
  const newTabs = tabs.filter((_, i) => i !== closedIndex)

  if (newTabs.length === 0) {
    return { tabs: [], active: null }
  }

  if (wasActive) {
    const successorIndex = closedIndex < newTabs.length ? closedIndex : newTabs.length - 1
    const nextActive = tabKey(newTabs[successorIndex])
    return {
      tabs: newTabs.map((t, i) => ({ ...t, active: i === successorIndex })),
      active: nextActive,
    }
  }

  const currentActive = active ?? (tabs.find(t => t.active) ? tabKey(tabs.find(t => t.active)!) : null)
  return {
    tabs: newTabs.map(t => ({ ...t, active: tabKey(t) === currentActive })),
    active: currentActive,
  }
}

export function renameTab(
  tabs: WorkspaceTab[],
  activeTab: string | { type: string; slug: string } | null,
  oldKey: string | { type: string; slug: string },
  newTarget: WorkspaceTab | { type: WorkspaceTabType; slug: string; active?: boolean }
): { tabs: WorkspaceTab[]; active: string | null } {
  const fromKey = tabKey(oldKey)
  const toKey = tabKey(newTarget)
  const active = activeTab ? tabKey(activeTab) : null
  const targetIndex = tabs.findIndex(t => tabKey(t) === fromKey)

  if (targetIndex === -1) {
    return { tabs: [...tabs], active }
  }

  const currentActive = active ?? (tabs.find(t => t.active) ? tabKey(tabs.find(t => t.active)!) : null)
  const wasActive = active !== null ? fromKey === active : Boolean(tabs[targetIndex].active)
  const nextActive = wasActive ? toKey : currentActive

  const nextTabs: WorkspaceTab[] = tabs.map((t, i) => {
    if (i === targetIndex) {
      return {
        type: newTarget.type,
        slug: newTarget.slug,
        active: wasActive,
      }
    }
    return {
      ...t,
      active: tabKey(t) === nextActive,
    }
  })

  return { tabs: nextTabs, active: nextActive }
}
