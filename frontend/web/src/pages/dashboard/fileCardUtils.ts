import type { SharedFile } from '../../api/files'
import { formatBytes } from './fileUtils'
import type { Item, ViewKey } from './types'

export function isShared(item: Item): item is SharedFile {
    return 'permissions' in item
}

export function formatExactBytes(bytes: number) {
    return `${new Intl.NumberFormat().format(bytes)} bytes (${formatBytes(bytes)})`
}

export function formatDateTime(iso: string | null) {
    if (!iso) return 'Not set'
    return new Date(iso).toLocaleString()
}

export function formatPermission(item: Item) {
    if (isShared(item)) {
        return item.permissions === 'write' ? 'Can edit' : 'Can view'
    }
    return item.is_public ? 'Public link' : 'Private'
}

export function formatSource(item: Item, view: ViewKey) {
    if (isShared(item)) {
        return item.shared_by_user_name ? `Shared by ${item.shared_by_user_name}` : `Shared by user ${item.shared_by_user_id}`
    }
    if (view === 'trash') return 'Trash'
    if (view === 'favourites') return 'Favourites'
    return 'My storage'
}
