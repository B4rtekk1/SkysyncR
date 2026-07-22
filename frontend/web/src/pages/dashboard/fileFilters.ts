import { kindFromFile } from './fileUtils.ts'
import type { FileTag, Tag } from '../../api/tags'
import type { FileFilters, FileSortKey, FileTypeFilterKey, FileVisibilityFilterKey, Item } from './types'

export const FILE_SORT_LABELS: Record<FileSortKey, string> = {
    manual: 'Manual order',
    'name-asc': 'Name A-Z',
    'name-desc': 'Name Z-A',
    'updated-desc': 'Newest first',
    'updated-asc': 'Oldest first',
    'size-desc': 'Largest first',
    'size-asc': 'Smallest first',
}

export const FILE_TYPE_FILTER_LABELS: Record<FileTypeFilterKey, string> = {
    image: 'Images',
    document: 'Docs',
    pdf: 'PDFs',
    sheet: 'Sheets',
    presentation: 'Slides',
    archive: 'Archives',
    video: 'Videos',
    audio: 'Audio',
    text: 'Text',
    code: 'Code',
    file: 'Other files',
}

export const FILE_TYPE_FILTER_OPTIONS: FileTypeFilterKey[] = [
    'image',
    'document',
    'pdf',
    'sheet',
    'presentation',
    'archive',
    'video',
    'audio',
    'text',
    'code',
    'file',
]

export const FILE_VISIBILITY_LABELS: Record<FileVisibilityFilterKey, string> = {
    any: 'Any',
    public: 'Shared',
    private: 'Not shared',
}

export function parseSizeMb(value: string) {
    const normalized = value.trim().replace(',', '.')
    if (!normalized) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function formatSizeValue(value: number) {
    if (!Number.isFinite(value)) return ''
    const rounded = Math.round(value * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatSizeFromKb(valueKb: number) {
    return valueKb >= 1024 ? `${formatSizeValue(valueKb / 1024)} MB` : `${Math.round(valueKb)} KB`
}

export function formatSizeInputValue(valueMb: string) {
    const parsed = parseSizeMb(valueMb)
    return parsed === null ? '' : formatSizeFromKb(parsed * 1024)
}

export function parseSizeInputToMb(value: string) {
    const normalized = value.trim().replace(',', '.').toUpperCase()
    if (!normalized) return ''

    const match = normalized.match(/^(\d*(?:\.\d*)?)\s*(KB|MB)?$/)
    if (!match) return null

    const parsed = Number(match[1])
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return formatSizeValue(match[2] === 'KB' ? parsed / 1024 : parsed)
}

function getFileExtension(filename: string) {
    const name = filename.trim().toLowerCase()
    const extensionStart = name.lastIndexOf('.')
    return extensionStart > 0 && extensionStart < name.length - 1 ? name.slice(extensionStart + 1) : ''
}

export function parseExcludedExtensions(value: string) {
    return value
        .split(/[\s,;]+/)
        .map((extension) => extension.trim().toLowerCase().replace(/^\.+/, ''))
        .filter(Boolean)
}

export function hasActiveFileFilters(filters: FileFilters) {
    return (
        filters.types.length > 0 ||
        filters.visibility !== 'any' ||
        filters.tagId !== '' ||
        filters.minSizeMb.trim() !== '' ||
        filters.maxSizeMb.trim() !== '' ||
        filters.excludedExtensions.trim() !== '' ||
        filters.modifiedFrom !== '' ||
        filters.modifiedTo !== ''
    )
}

export function getFilterSummary(filters: FileFilters, tags: Tag[] = []) {
    const excludedExtensions = parseExcludedExtensions(filters.excludedExtensions)
    const selectedTag = filters.tagId ? tags.find((tag) => tag.id === filters.tagId) : null
    const activeParts = [
        filters.types.length > 0 ? `${filters.types.length} type${filters.types.length > 1 ? 's' : ''}` : null,
        filters.visibility !== 'any' ? FILE_VISIBILITY_LABELS[filters.visibility] : null,
        selectedTag ? `Tag: ${selectedTag.name}` : filters.tagId ? 'Tag' : null,
        filters.minSizeMb.trim() || filters.maxSizeMb.trim() ? 'Size' : null,
        excludedExtensions.length > 0 ? `${excludedExtensions.length} excluded` : null,
        filters.modifiedFrom || filters.modifiedTo ? 'Modified' : null,
    ].filter(Boolean)

    return activeParts.length > 0 ? activeParts.join(' · ') : 'All files'
}

export function matchesFileFilters(item: Item, filters: FileFilters, fileTags: FileTag[] = []) {
    if (filters.types.length > 0 && !filters.types.includes(kindFromFile(item.filename, item.mime_type))) {
        return false
    }
    if (filters.visibility === 'public' && !item.is_public) return false
    if (filters.visibility === 'private' && item.is_public) return false
    if (filters.tagId && !fileTags.some((tag) => tag.tag_id === filters.tagId)) return false

    const minSizeMb = parseSizeMb(filters.minSizeMb)
    const maxSizeMb = parseSizeMb(filters.maxSizeMb)
    const sizeMb = item.size_bytes / (1024 * 1024)

    if (minSizeMb !== null && sizeMb < minSizeMb) return false
    if (maxSizeMb !== null && sizeMb > maxSizeMb) return false

    const excludedExtensions = parseExcludedExtensions(filters.excludedExtensions)
    if (excludedExtensions.includes(getFileExtension(item.filename))) return false

    const modifiedAt = new Date(item.updated_at).getTime()
    if (filters.modifiedFrom) {
        const modifiedFrom = new Date(`${filters.modifiedFrom}T00:00:00`).getTime()
        if (Number.isFinite(modifiedFrom) && modifiedAt < modifiedFrom) return false
    }
    if (filters.modifiedTo) {
        const modifiedTo = new Date(`${filters.modifiedTo}T23:59:59.999`).getTime()
        if (Number.isFinite(modifiedTo) && modifiedAt > modifiedTo) return false
    }
    return true
}

function compareStrings(a: string, b: string) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function compareDates(a: string, b: string) {
    return new Date(a).getTime() - new Date(b).getTime()
}

export function sortFiles(items: Item[], sortKey: FileSortKey) {
    if (sortKey === 'manual') return items

    return [...items].sort((a, b) => {
        switch (sortKey) {
            case 'name-asc':
                return compareStrings(a.filename, b.filename)
            case 'name-desc':
                return compareStrings(b.filename, a.filename)
            case 'updated-desc':
                return compareDates(b.updated_at, a.updated_at)
            case 'updated-asc':
                return compareDates(a.updated_at, b.updated_at)
            case 'size-desc':
                return b.size_bytes - a.size_bytes
            case 'size-asc':
                return a.size_bytes - b.size_bytes
            default:
                return 0
        }
    })
}
