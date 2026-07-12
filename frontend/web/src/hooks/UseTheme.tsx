import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export type ThemePreference = Theme | 'system'

const THEME_STORAGE_KEY = 'theme_preference'
const THEME_CHANGE_EVENT = 'skysyncr-theme-change'
const THEME_TRANSITION_MS = 520
const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)'

type ThemeOrigin = {
    x: number
    y: number
}

type ThemeChangeDetail = {
    preference: ThemePreference
    theme: Theme
}

type ThemeChangeEvent = CustomEvent<ThemeChangeDetail>

type ViewTransition = {
    finished: Promise<void>
}

type DocumentWithViewTransition = Document & {
    startViewTransition?: (updateCallback: () => void) => ViewTransition
}

function getSystemTheme(): Theme {
    if (typeof window !== 'undefined' && window.matchMedia?.(SYSTEM_LIGHT_QUERY).matches) {
        return 'light'
    }
    return 'dark'
}

function resolveTheme(preference: ThemePreference): Theme {
    return preference === 'system' ? getSystemTheme() : preference
}

function loadThemePreference(): ThemePreference {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY)
        if (raw === 'system' || raw === 'light' || raw === 'dark') return raw
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
    return 'system'
}

function saveThemePreference(preference: ThemePreference) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme)
}

export function useTheme() {
    const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => loadThemePreference())
    const [theme, setTheme] = useState<Theme>(() => resolveTheme(loadThemePreference()))

    const setThemePreferenceEverywhere = useCallback((nextPreference: ThemePreference) => {
        const nextTheme = resolveTheme(nextPreference)

        saveThemePreference(nextPreference)
        applyTheme(nextTheme)
        setThemePreferenceState(nextPreference)
        setTheme(nextTheme)
        window.dispatchEvent(
            new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, {
                detail: {
                    preference: nextPreference,
                    theme: nextTheme,
                },
            }),
        )
    }, [])

    useEffect(() => {
        function syncTheme(event: Event) {
            const { preference, theme } = (event as ThemeChangeEvent).detail
            setThemePreferenceState(preference)
            setTheme(theme)
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

        function syncSystemTheme() {
            if (themePreference === 'system') {
                setThemePreferenceEverywhere('system')
            }
        }

        systemTheme.addEventListener('change', syncSystemTheme)
        return () => systemTheme.removeEventListener('change', syncSystemTheme)
    }, [setThemePreferenceEverywhere, themePreference])

    function changeThemePreference(nextPreference: ThemePreference, origin?: ThemeOrigin) {
        const nextTheme = resolveTheme(nextPreference)
        const root = document.documentElement
        const themeWillChange = nextTheme !== theme
        const supportsViewTransition = 'startViewTransition' in document && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

        if (!themeWillChange) {
            setThemePreferenceEverywhere(nextPreference)
            return
        }

        if (origin) {
            root.style.setProperty('--theme-transition-x', `${origin.x}px`)
            root.style.setProperty('--theme-transition-y', `${origin.y}px`)
        }

        if (supportsViewTransition) {
            root.classList.add('is-theme-transitioning')
            const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
                setThemePreferenceEverywhere(nextPreference)
            })

            transition?.finished.finally(() => {
                root.classList.remove('is-theme-transitioning')
            })
            return
        }

        root.classList.add('is-theme-fading')
        setThemePreferenceEverywhere(nextPreference)
        window.setTimeout(() => root.classList.remove('is-theme-fading'), THEME_TRANSITION_MS)
    }

    function toggleTheme(origin?: ThemeOrigin) {
        changeThemePreference(theme === 'dark' ? 'light' : 'dark', origin)
    }

    return {
        theme,
        themePreference,
        setThemePreference: changeThemePreference,
        toggleTheme,
    }
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
