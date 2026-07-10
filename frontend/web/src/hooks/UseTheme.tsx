import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'theme'

function loadTheme(): Theme {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY)
        if (raw === 'light' || raw === 'dark') return raw
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
            return 'light'
        }
        return 'dark'
    } catch {
        return 'dark'
    }
}

function saveTheme(theme: Theme) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export function useTheme() {
    const [theme, setTheme] = useState<Theme>(() => loadTheme())

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
        saveTheme(theme)
    }, [theme])

    function toggleTheme() {
        setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
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