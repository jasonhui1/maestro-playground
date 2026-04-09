import { WorkspaceTab, WorkspaceTabType } from '../types'

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
