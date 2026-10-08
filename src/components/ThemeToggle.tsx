import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import './ThemeToggle.css'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'adaptivelearn-theme'

/**
 * The inline script in index.html has already resolved the initial theme
 * (saved choice > OS preference) and set it as data-theme on <html>,
 * so we can read it from there without a flash of the wrong theme.
 */
function getInitialTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage unavailable (e.g. private mode) — theme still applies this session.
    }
  }, [theme])

  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle dark theme"
      aria-pressed={isDark}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        <Sun size={20} aria-hidden="true" />
      ) : (
        <Moon size={20} aria-hidden="true" />
      )}
    </button>
  )
}
