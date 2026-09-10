import { useCallback, useEffect, useState } from 'react'

/**
 * Theme plumbing.
 *
 * A theme is nothing but a `data-theme` value on <html>; all the actual colours
 * live in index.css. Adding a fourth theme means adding one entry here and one
 * override block there — no component changes.
 */

export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'pastel', label: 'Pastel' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const STORAGE_KEY = 'clockwiser:theme'

const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

/**
 * `?theme=pastel` wins (handy for demoing or sharing a link in a fixed theme),
 * then the stored choice, then whatever the OS asks for.
 */
export function initialTheme(): ThemeId {
  const fromUrl = new URLSearchParams(window.location.search).get('theme')
  if (isTheme(fromUrl)) return fromUrl
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isTheme(stored)) return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useTheme() {
  // index.html has already applied a theme pre-paint; trust it as the source of
  // truth so the first render can't disagree with what's on screen.
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const applied = document.documentElement.dataset.theme
    return isTheme(applied) ? applied : initialTheme()
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private browsing / storage disabled — the theme still applies for this session.
    }
  }, [])

  return { theme, setTheme }
}
