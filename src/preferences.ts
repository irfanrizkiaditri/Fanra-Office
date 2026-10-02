import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStored(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* storage may be blocked */ }
}

export function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = readStored('mc.theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Theme preference, remembered per browser. */
export function usePreferences() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeStored('mc.theme', theme)
  }, [theme])

  return {
    theme,
    toggleTheme: () => setTheme((value) => (value === 'dark' ? 'light' : 'dark')),
  }
}
