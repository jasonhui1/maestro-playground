'use client'
import { useCallback, useEffect, useState } from 'react'
import { FIT_STORAGE_KEY, isPanelFit, PanelFit } from '@/lib/panelFit'

/** Remembers the chosen fit across surfaces and reloads. Reads after mount: the server
 *  has no localStorage and a first-paint mismatch would hydrate-warn. */
export function usePanelFit(): [PanelFit, (next: PanelFit) => void] {
  const [fit, setFit] = useState<PanelFit>('spread')

  useEffect(() => {
    const stored = window.localStorage.getItem(FIT_STORAGE_KEY)
    if (isPanelFit(stored)) setFit(stored)
  }, [])

  const choose = useCallback((next: PanelFit) => {
    setFit(next)
    window.localStorage.setItem(FIT_STORAGE_KEY, next)
  }, [])

  return [fit, choose]
}
