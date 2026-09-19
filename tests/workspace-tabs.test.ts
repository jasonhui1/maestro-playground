import { test, describe, expect } from 'vitest'
import {
  parseTabs,
  serializeTabs,
  openTab,
  closeTab,
  renameTab,
  tabKey,
  MAX_TABS,
} from '../lib/fs/tabs'
import { WorkspaceTab } from '../lib/types'

describe('workspace-tabs', () => {
  describe('parseTabs', () => {
    test('empty tabsParam with active tab', () => {
      const tabs = parseTabs(null, 'agent', 'dm')
      expect(tabs).toEqual([{ type: 'agent', slug: 'dm', active: true }])
    })

    test('tabsParam with multiple tabs and active tab in list', () => {
      const tabs = parseTabs('agent:dm,chain:story', 'chain', 'story')
      expect(tabs).toEqual([
        { type: 'agent', slug: 'dm', active: false },
        { type: 'chain', slug: 'story', active: true },
      ])
    })

    test('tabsParam with multiple tabs and active tab NOT in list', () => {
      const tabs = parseTabs('agent:dm', 'chain', 'story')
      expect(tabs).toHaveLength(2)
      expect(tabs.find(t => t.type === 'chain' && t.slug === 'story' && t.active)).toBeDefined()
    })

    test('invalid tabsParam', () => {
      const tabs = parseTabs('invalid', 'agent', 'dm')
      expect(tabs).toEqual([{ type: 'agent', slug: 'dm', active: true }])
    })
  })

  describe('serializeTabs', () => {
    test('serializes tab array', () => {
      const tabs: WorkspaceTab[] = [
        { type: 'agent', slug: 'dm', active: false },
        { type: 'chain', slug: 'story', active: true },
      ]
      expect(serializeTabs(tabs)).toBe('agent:dm,chain:story')
    })

    test('serializes empty tab array', () => {
      expect(serializeTabs([])).toBe('')
    })
  })

  describe('tabKey', () => {
    test('formats object or preserves string', () => {
      expect(tabKey({ type: 'agent', slug: 'dm' })).toBe('agent:dm')
      expect(tabKey('chain:story')).toBe('chain:story')
    })
  })

  describe('openTab', () => {
    test('opens a tab into an empty list', () => {
      const { tabs, active } = openTab([], { type: 'agent', slug: 'writer' })
      expect(tabs).toEqual([{ type: 'agent', slug: 'writer', active: true }])
      expect(active).toBe('agent:writer')
    })

    test('appends new tab and makes it active', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
      ]
      const { tabs, active } = openTab(initial, { type: 'chain', slug: 'beta' })
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'chain', slug: 'beta', active: true },
      ])
      expect(active).toBe('chain:beta')
    })

    test('deduplicates and preserves existing order when opening an already-open tab', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
        { type: 'chain', slug: 'beta', active: false },
        { type: 'agent', slug: 'gamma', active: false },
      ]
      const { tabs, active } = openTab(initial, { type: 'chain', slug: 'beta' })
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'chain', slug: 'beta', active: true },
        { type: 'agent', slug: 'gamma', active: false },
      ])
      expect(active).toBe('chain:beta')
    })

    test('enforces MAX_TABS cap by evicting oldest tab when cap is exceeded', () => {
      expect(MAX_TABS).toBe(15)

      const fullTabs: WorkspaceTab[] = Array.from({ length: MAX_TABS }, (_, i) => ({
        type: 'agent' as const,
        slug: `agent-${i}`,
        active: i === 14,
      }))

      const { tabs, active } = openTab(fullTabs, { type: 'agent', slug: 'agent-15' })
      expect(tabs).toHaveLength(MAX_TABS)
      expect(tabs[0].slug).toBe('agent-1')
      expect(tabs[MAX_TABS - 1].slug).toBe('agent-15')
      expect(tabs[MAX_TABS - 1].active).toBe(true)
      expect(active).toBe('agent:agent-15')
    })

    test('does not evict tabs at cap if opening an existing tab', () => {
      const fullTabs: WorkspaceTab[] = Array.from({ length: MAX_TABS }, (_, i) => ({
        type: 'agent' as const,
        slug: `agent-${i}`,
        active: i === 14,
      }))

      const { tabs, active } = openTab(fullTabs, { type: 'agent', slug: 'agent-0' })
      expect(tabs).toHaveLength(MAX_TABS)
      expect(tabs[0].slug).toBe('agent-0')
      expect(tabs[0].active).toBe(true)
      expect(active).toBe('agent:agent-0')
    })
  })

  describe('closeTab', () => {
    test('closing an inactive tab preserves the active tab and removes target', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
        { type: 'chain', slug: 'beta', active: false },
        { type: 'agent', slug: 'gamma', active: false },
      ]
      const { tabs, active } = closeTab(initial, 'agent:alpha', 'chain:beta')
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: true },
        { type: 'agent', slug: 'gamma', active: false },
      ])
      expect(active).toBe('agent:alpha')
    })

    test('explicit activeTab overrides stale tab.active flag', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'chain', slug: 'beta', active: true },
      ]
      const { tabs, active } = closeTab(initial, 'agent:alpha', 'chain:beta')
      expect(tabs).toEqual([{ type: 'agent', slug: 'alpha', active: true }])
      expect(active).toBe('agent:alpha')
    })

    test('successor on close: closing active tab at index 0 selects next tab', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
        { type: 'chain', slug: 'beta', active: false },
        { type: 'agent', slug: 'gamma', active: false },
      ]
      const { tabs, active } = closeTab(initial, 'agent:alpha', 'agent:alpha')
      expect(tabs).toEqual([
        { type: 'chain', slug: 'beta', active: true },
        { type: 'agent', slug: 'gamma', active: false },
      ])
      expect(active).toBe('chain:beta')
    })

    test('successor on close: closing active tab in middle selects next tab', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'chain', slug: 'beta', active: true },
        { type: 'agent', slug: 'gamma', active: false },
      ]
      const { tabs, active } = closeTab(initial, 'chain:beta', 'chain:beta')
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'agent', slug: 'gamma', active: true },
      ])
      expect(active).toBe('agent:gamma')
    })

    test('successor on close: closing active tab at end of list selects previous tab', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'chain', slug: 'beta', active: false },
        { type: 'agent', slug: 'gamma', active: true },
      ]
      const { tabs, active } = closeTab(initial, 'agent:gamma', 'agent:gamma')
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'chain', slug: 'beta', active: true },
      ])
      expect(active).toBe('chain:beta')
    })

    test('successor on close: closing the only tab yields empty tabs and null active', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
      ]
      const { tabs, active } = closeTab(initial, 'agent:alpha', 'agent:alpha')
      expect(tabs).toEqual([])
      expect(active).toBeNull()
    })

    test('closing a nonexistent tab leaves list and active unchanged', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
      ]
      const { tabs, active } = closeTab(initial, 'agent:alpha', 'agent:nonexistent')
      expect(tabs).toEqual(initial)
      expect(active).toBe('agent:alpha')
    })
  })

  describe('renameTab', () => {
    test('renaming an active tab preserves order and repoints active', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'agent', slug: 'beta', active: true },
        { type: 'chain', slug: 'gamma', active: false },
      ]
      const { tabs, active } = renameTab(
        initial,
        'agent:beta',
        'agent:beta',
        { type: 'agent', slug: 'beta-renamed' }
      )
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: false },
        { type: 'agent', slug: 'beta-renamed', active: true },
        { type: 'chain', slug: 'gamma', active: false },
      ])
      expect(active).toBe('agent:beta-renamed')
    })

    test('renaming an inactive tab preserves order and keeps existing active tab', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
        { type: 'agent', slug: 'beta', active: false },
        { type: 'chain', slug: 'gamma', active: false },
      ]
      const { tabs, active } = renameTab(
        initial,
        'agent:alpha',
        'agent:beta',
        { type: 'agent', slug: 'beta-renamed' }
      )
      expect(tabs).toEqual([
        { type: 'agent', slug: 'alpha', active: true },
        { type: 'agent', slug: 'beta-renamed', active: false },
        { type: 'chain', slug: 'gamma', active: false },
      ])
      expect(active).toBe('agent:alpha')
    })

    test('renaming a nonexistent tab leaves list and active unchanged', () => {
      const initial: WorkspaceTab[] = [
        { type: 'agent', slug: 'alpha', active: true },
      ]
      const { tabs, active } = renameTab(
        initial,
        'agent:alpha',
        'agent:nonexistent',
        { type: 'agent', slug: 'new' }
      )
      expect(tabs).toEqual(initial)
      expect(active).toBe('agent:alpha')
    })
  })
})
