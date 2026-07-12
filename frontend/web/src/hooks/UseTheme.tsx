import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const THEME_CHANGE_EVENT = 'skysyncr-theme-change'
const THEME_TRANSITION_MS = 520
const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)'

type ThemeOrigin = {
    x: number
    y: number
}

type ThemeChangeEvent = CustomEvent<Theme>

type ViewTransition = {
    finished: Promise<void>
}

type DocumentWithViewTransition = Document & {
    startViewTransition?: (updateCallback: () => void) => ViewTransition
}

function loadTheme(): Theme {
    if (typeof window !== 'undefined' && window.matchMedia?.(SYSTEM_LIGHT_QUERY).matches) {
        return 'light'
    }
    return 'dark'
}

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme)
}

export function useTheme() {
    const [theme, setTheme] = useState<Theme>(() => loadTheme())

    const setThemeEverywhere = useCallback((nextTheme: Theme) => {
        applyTheme(nextTheme)
        setTheme(nextTheme)
        window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: nextTheme }))
    }, [])

    useEffect(() => {
        function syncTheme(event: Event) {
            setTheme((event as ThemeChangeEvent).detail)
        }

        window.addEventListener(THEME_CHANGE_EVENT, syncTheme)
        return () => window.removeEventListener(THEME_CHANGE_EVENT, syncTheme)
    }, [])

    useEffect(() => {
        applyTheme(theme)
    }, [theme])

    useEffect(() => {
        const systemTheme = window.matchMedia?.(SYSTEM_LIGHT_QUERY)
        if (!systemTheme) return undefined

        function syncSystemTheme(event: MediaQueryListEvent) {
            setThemeEverywhere(event.matches ? 'light' : 'dark')
        }

        systemTheme.addEventListener('change', syncSystemTheme)
        return () => systemTheme.removeEventListener('change', syncSystemTheme)
    }, [setThemeEverywhere])

    function toggleTheme(origin?: ThemeOrigin) {
        const nextTheme = theme === 'dark' ? 'light' : 'dark'
        const root = document.documentElement
        const supportsViewTransition = 'startViewTransition' in document && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

        if (origin) {
            root.style.setProperty('--theme-transition-x', `${origin.x}px`)
            root.style.setProperty('--theme-transition-y', `${origin.y}px`)
        }

        if (supportsViewTransition) {
            root.classList.add('is-theme-transitioning')
            const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
                setThemeEverywhere(nextTheme)
            })

            transition?.finished.finally(() => {
                root.classList.remove('is-theme-transitioning')
            })
            return
        }

        root.classList.add('is-theme-fading')
        setThemeEverywhere(nextTheme)
        window.setTimeout(() => root.classList.remove('is-theme-fading'), THEME_TRANSITION_MS)
    }

    return { theme, toggleTheme }
}

export const SUN_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
<circle cx="12" cy="12" r="4.2" />
<path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
    </svg>
)

export const MOON_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
<path d="M20.5 14.6A8.5 8.5 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1Z" />
    </svg>
)
