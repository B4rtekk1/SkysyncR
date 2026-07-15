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
const VIEW_KEYS: ViewKey[] = ['all', 'favourites', 'shared', 'groups', 'calendar', 'trash']

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
            displayName: user?.display_name ?? saved.displayName ?? '',
            avatarUrl: user?.avatar_url ?? saved.avatarUrl ?? '',
            defaultView: isViewKey(user?.default_view) ? user.default_view : saved.defaultView ?? DEFAULT_SETTINGS.defaultView,
            layoutMode: isLayoutMode(user?.layout_mode) ? user.layout_mode : saved.layoutMode ?? DEFAULT_SETTINGS.layoutMode,
            uploadProtection: user?.upload_protection ?? saved.uploadProtection ?? DEFAULT_SETTINGS.uploadProtection,
            compactMetadata: user?.compact_metadata ?? saved.compactMetadata ?? DEFAULT_SETTINGS.compactMetadata,
            deviceLock: user?.device_lock ?? saved.deviceLock ?? DEFAULT_SETTINGS.deviceLock,
            syncOnMetered: user?.sync_on_metered ?? saved.syncOnMetered ?? DEFAULT_SETTINGS.syncOnMetered,
            trashRetentionDays: user?.trash_retention_days ?? saved.trashRetentionDays ?? DEFAULT_SETTINGS.trashRetentionDays,
        }
    } catch {
        return {
            ...DEFAULT_SETTINGS,
            displayName: user?.display_name || '',
            avatarUrl: user?.avatar_url || '',
        }
    }
}

function isViewKey(value: unknown): value is ViewKey {
    return typeof value === 'string' && VIEW_KEYS.includes(value as ViewKey)
}

function isLayoutMode(value: unknown): value is LayoutMode {
    return value === 'grid' || value === 'list'
}

export function clearLegacyProfileStorage() {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
    localStorage.removeItem(AVATAR_STORAGE_KEY)
    localStorage.removeItem('display_name')
    sessionStorage.removeItem('display_name')
}
