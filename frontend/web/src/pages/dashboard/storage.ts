import type { Group, GroupInvite, Item, LayoutMode, ViewKey } from './types'
export const FAVOURITES_STORAGE_KEY = 'favourite_file_ids'
export const LOCAL_FILE_META_STORAGE_KEY = 'local_file_metadata'
export const LAYOUT_MODE_STORAGE_KEY = 'file_layout_mode'
export const GROUPS_STORAGE_KEY = 'groups'
export const LEGACY_GROUP_INVITES_STORAGE_KEY = 'group_invites'

type LocalFileMeta = {
    filename: string
    mime_type: string | null
}

export function loadLocalFileMetadata(): Record<string, LocalFileMeta> {
    try {
        const raw = localStorage.getItem(LOCAL_FILE_META_STORAGE_KEY)
        return raw ? (JSON.parse(raw) as Record<string, LocalFileMeta>) : {}
    } catch {
        return {}
    }
}

export function saveLocalFileMetadata(id: string, metadata: LocalFileMeta) {
    try {
        const current = loadLocalFileMetadata()
        current[id] = metadata
        localStorage.setItem(LOCAL_FILE_META_STORAGE_KEY, JSON.stringify(current))
    } catch {
        // keep server-side encrypted metadata as the fallback
    }
}

export function applyLocalFileMetadata<T extends Item>(data: T[]): T[] {
    const metadata = loadLocalFileMetadata()
    return data.map((item) => {
        const local = metadata[item.id]
        return local ? { ...item, filename: local.filename, mime_type: local.mime_type } : item
    })
}

export function loadFavouriteIds(): Set<string> {
    try {
        const raw = localStorage.getItem(FAVOURITES_STORAGE_KEY)
        return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
        return new Set()
    }
}

export function saveFavouriteIds(ids: Set<string>) {
    try {
        localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(Array.from(ids)))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export function loadLayoutMode(): LayoutMode {
    try {
        const raw = localStorage.getItem(LAYOUT_MODE_STORAGE_KEY)
        return raw === 'list' || raw === 'grid' ? raw : 'grid'
    } catch {
        return 'grid'
    }
}

export function saveLayoutMode(mode: LayoutMode) {
    try {
        localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode)
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export function loadGroups(): Group[] {
    try {
        const raw = localStorage.getItem(GROUPS_STORAGE_KEY)
        if (raw) {
            return (JSON.parse(raw) as Group[]).map((group) => ({
                ...group,
                defaultRole: group.defaultRole ?? 'viewer',
                invites: group.invites ?? [],
            }))
        }

        const legacyRaw = localStorage.getItem(LEGACY_GROUP_INVITES_STORAGE_KEY)
        const legacyInvites = legacyRaw ? (JSON.parse(legacyRaw) as GroupInvite[]) : []
        return legacyInvites.length > 0
            ? [
                  {
                      id: crypto.randomUUID(),
                      name: 'Main group',
                      defaultRole: 'viewer',
                      createdAt: new Date().toISOString(),
                      invites: legacyInvites,
                  },
              ]
            : []
    } catch {
        return []
    }
}

export function saveGroups(groups: Group[]) {
    try {
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export const ORDER_STORAGE_PREFIX = 'file_order_'
export const SEARCH_FILTER_EXIT_MS = 240
export const LAYOUT_SWITCH_MS = 420

export function loadOrderIds(view: ViewKey): string[] {
    try {
        const raw = localStorage.getItem(ORDER_STORAGE_PREFIX + view)
        return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
        return []
    }
}

export function saveOrderIds(view: ViewKey, ids: string[]) {
    try {
        localStorage.setItem(ORDER_STORAGE_PREFIX + view, JSON.stringify(ids))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export function applySavedOrder<T extends Item>(data: T[], view: ViewKey): T[] {
    const savedOrder = loadOrderIds(view)
    if (savedOrder.length === 0) return data
    const positions = new Map(savedOrder.map((id, i) => [id, i]))
    return [...data].sort((a, b) => {
        const posA = positions.has(a.id) ? (positions.get(a.id) as number) : Number.MAX_SAFE_INTEGER
        const posB = positions.has(b.id) ? (positions.get(b.id) as number) : Number.MAX_SAFE_INTEGER
        return posA - posB
    })
}

export const NAV_ORDER_STORAGE_KEY = 'nav_order'
export const ACTIVE_VIEW_STORAGE_KEY = 'active_view'
export const DEFAULT_NAV_ORDER: ViewKey[] = ['all', 'favourites', 'shared', 'groups', 'trash']
export const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar_width'
export const SIDEBAR_HIDDEN_STORAGE_KEY = 'sidebar_hidden'
export const MIN_SIDEBAR_WIDTH = 72
export const MAX_SIDEBAR_WIDTH = 340
export const DEFAULT_SIDEBAR_WIDTH = 240
export const COMPACT_SIDEBAR_WIDTH = 128

export function clampSidebarWidth(width: number) {
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

export function loadSidebarWidth() {
    try {
        const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
        return raw ? clampSidebarWidth(Number(raw)) : DEFAULT_SIDEBAR_WIDTH
    } catch {
        return DEFAULT_SIDEBAR_WIDTH
    }
}

export function loadSidebarHidden() {
    try {
        return localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

export function loadNavOrder(): ViewKey[] {
    try {
        const raw = localStorage.getItem(NAV_ORDER_STORAGE_KEY)
        if (!raw) return DEFAULT_NAV_ORDER
        const saved = JSON.parse(raw) as ViewKey[]
        const known = saved.filter((k) => DEFAULT_NAV_ORDER.includes(k))
        const missing = DEFAULT_NAV_ORDER.filter((k) => !known.includes(k))
        return [...known, ...missing]
    } catch {
        return DEFAULT_NAV_ORDER
    }
}

export function saveNavOrder(order: ViewKey[]) {
    try {
        localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(order))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export function loadActiveView(): ViewKey {
    try {
        const raw = localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY)
        return DEFAULT_NAV_ORDER.includes(raw as ViewKey) ? (raw as ViewKey) : 'all'
    } catch {
        return 'all'
    }
}

export function saveActiveView(view: ViewKey) {
    try {
        localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view)
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

export const NAV_LABELS: Record<ViewKey, string> = {
    all: 'All files',
    favourites: 'Favourites',
    shared: 'Shared with me',
    groups: 'Groups',
    trash: 'Trash',
}


