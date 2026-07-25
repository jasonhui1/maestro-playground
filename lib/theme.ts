// Pure theme-resolution logic, shared between the blocking anti-flash script
// (duplicated there as plain JS — it runs before any module can load) and the
// client-side ThemeProvider. Keep the two in sync if this logic changes.
export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'maestro-theme'

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}

// Inlined verbatim into a blocking <script> in layout.tsx's <head> — must run
// before paint, so it can't import resolveInitialTheme as a function call.
// Keep this string's logic identical to resolveInitialTheme above.
export const themeInitScript = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`
