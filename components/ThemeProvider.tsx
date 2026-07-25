'use client'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Theme, THEME_STORAGE_KEY } from '@/lib/theme'

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

function readAppliedTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

// Initial theme is applied synchronously by the blocking script in layout.tsx
// (before hydration, to avoid a flash of the wrong theme). State must read
// that already-applied class as its *initial* value, not a hardcoded guess
// corrected in a later effect — a mount effect firing on a stale 'light'
// default would toggle .dark off for a frame before a second render fixed
// it, flashing the very theme the blocking script was meant to prevent.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readAppliedTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
