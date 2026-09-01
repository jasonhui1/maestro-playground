'use client'
import { useCallback, useState } from 'react'
import { PanelDeck, toggleSelection } from '@/lib/panelDeck'

/** Holds the shared panel contract's state for whichever layout is on screen (#73). */
export function usePanelDeck(): PanelDeck & { reset: () => void } {
  const [open, setOpen] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])

  const toggleSelect = useCallback((i: number) => setSelected(prev => toggleSelection(prev, i)), [])
  const reset = useCallback(() => { setOpen(null); setSelected([]) }, [])

  return { open, selected, openPanel: setOpen, toggleSelect, reset }
}
