'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_FIT, FIT_STORAGE_KEY, isPanelFit, PanelFit } from '@/lib/panelFit'

// The store is `localStorage` itself, so the two surfaces that offer the switch cannot
// hold different answers. `storage` only fires in *other* tabs, so a local write
// announces itself.
const CHANGED = 'maestro:panel-fit-changed'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

function readFit(): PanelFit {
  const stored = window.localStorage.getItem(FIT_STORAGE_KEY)
  return isPanelFit(stored) ? stored : DEFAULT_FIT
}

/** Remembers the chosen fit across surfaces and reloads. The server has no
 *  `localStorage`, so it renders the default and the client swaps in the stored value
 *  on hydration rather than in an effect. */
export function usePanelFit(): [PanelFit, (next: PanelFit) => void] {
  const fit = useSyncExternalStore(subscribe, readFit, () => DEFAULT_FIT)

  const choose = useCallback((next: PanelFit) => {
    window.localStorage.setItem(FIT_STORAGE_KEY, next)
    window.dispatchEvent(new Event(CHANGED))
  }, [])

  return [fit, choose]
}
