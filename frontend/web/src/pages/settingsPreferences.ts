import type { CurrentUserResponse } from '../api/users'
import type { LayoutMode, ViewKey } from './dashboard/types'

export type SettingsState = {
    displayName: string
    avatarUrl: string
    defaultView: ViewKey
    layoutMode: LayoutMode
    uploadProtection: boolean
    compactMetadata: boolean
    deviceLock: boolean
    syncOnMetered: boolean
    trashRetentionDays: number
}

const SETTINGS_STORAGE_KEY = 'settings_preferences'
const AVATAR_STORAGE_KEY = 'avatar_url'

export const DEFAULT_SETTINGS: SettingsState = {
    displayName: '',
    avatarUrl: '',
    defaultView: 'all',
    layoutMode: 'grid',
    uploadProtection: true,
    compactMetadata: true,
    deviceLock: false,
    syncOnMetered: false,
    trashRetentionDays: 30,
}

export function userSettingsStorageKey(userId: string): string {
    return `${SETTINGS_STORAGE_KEY}:${userId}`
}

export function loadUserSettings(user: CurrentUserResponse | null): SettingsState {
    try {
        const raw = user ? localStorage.getItem(userSettingsStorageKey(user.id)) : null
        const saved = raw ? (JSON.parse(raw) as Partial<SettingsState>) : {}
        return {
            ...DEFAULT_SETTINGS,
            ...saved,
            displayName: saved.displayName || user?.display_name || '',
            avatarUrl: saved.avatarUrl || '',
            trashRetentionDays: user?.trash_retention_days ?? saved.trashRetentionDays ?? DEFAULT_SETTINGS.trashRetentionDays,
        }
    } catch {
        return {
            ...DEFAULT_SETTINGS,
            displayName: user?.display_name || '',
        }
    }
}

export function clearLegacyProfileStorage() {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
    localStorage.removeItem(AVATAR_STORAGE_KEY)
    localStorage.removeItem('display_name')
    sessionStorage.removeItem('display_name')
}
