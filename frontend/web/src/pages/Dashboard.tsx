import React, {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
    type MouseEvent as ReactMouseEvent,
} from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Dashbord.css'
import ThemeToggle from '../components/ThemeToggle'
import {
    listFiles,
    listTrash,
    listSharedFilesWithMe,
    getStorageQuota,
    softDeleteFile,
    restoreFile,
    uploadFile,
    downloadFile,
    type ApiFile,
    type SharedFile,
    type StorageQuota,
} from '../api/files'
import { logout } from '../api/auth'
import { getCurrentUser } from '../api/users'
import {
    generateFileKey,
    encryptFile,
    wrapFileKeyForUser,
} from '../crypto/fileEncryption'

type ViewKey = 'all' | 'favourites' | 'shared' | 'trash'
type LayoutMode = 'grid' | 'list'
type Item = ApiFile | SharedFile

type NavIndicator = {
    x: number
    y: number
    width: number
    height: number
    visible: boolean
}

const FAVOURITES_STORAGE_KEY = 'favourite_file_ids'
const LOCAL_FILE_META_STORAGE_KEY = 'local_file_metadata'
const LAYOUT_MODE_STORAGE_KEY = 'file_layout_mode'

type LocalFileMeta = {
    filename: string
    mime_type: string | null
}

function loadLocalFileMetadata(): Record<string, LocalFileMeta> {
    try {
        const raw = localStorage.getItem(LOCAL_FILE_META_STORAGE_KEY)
        return raw ? (JSON.parse(raw) as Record<string, LocalFileMeta>) : {}
    } catch {
        return {}
    }
}

function saveLocalFileMetadata(id: string, metadata: LocalFileMeta) {
    try {
        const current = loadLocalFileMetadata()
        current[id] = metadata
        localStorage.setItem(LOCAL_FILE_META_STORAGE_KEY, JSON.stringify(current))
    } catch {
        // keep server-side encrypted metadata as the fallback
    }
}

function applyLocalFileMetadata<T extends Item>(data: T[]): T[] {
    const metadata = loadLocalFileMetadata()
    return data.map((item) => {
        const local = metadata[item.id]
        return local ? { ...item, filename: local.filename, mime_type: local.mime_type } : item
    })
}

function loadFavouriteIds(): Set<string> {
    try {
        const raw = localStorage.getItem(FAVOURITES_STORAGE_KEY)
        return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
        return new Set()
    }
}

function saveFavouriteIds(ids: Set<string>) {
    try {
        localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(Array.from(ids)))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

function loadLayoutMode(): LayoutMode {
    try {
        const raw = localStorage.getItem(LAYOUT_MODE_STORAGE_KEY)
        return raw === 'list' || raw === 'grid' ? raw : 'grid'
    } catch {
        return 'grid'
    }
}

function saveLayoutMode(mode: LayoutMode) {
    try {
        localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode)
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

const ORDER_STORAGE_PREFIX = 'file_order_'

function loadOrderIds(view: ViewKey): string[] {
    try {
        const raw = localStorage.getItem(ORDER_STORAGE_PREFIX + view)
        return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
        return []
    }
}

function saveOrderIds(view: ViewKey, ids: string[]) {
    try {
        localStorage.setItem(ORDER_STORAGE_PREFIX + view, JSON.stringify(ids))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

function applySavedOrder<T extends Item>(data: T[], view: ViewKey): T[] {
    const savedOrder = loadOrderIds(view)
    if (savedOrder.length === 0) return data
    const positions = new Map(savedOrder.map((id, i) => [id, i]))
    return [...data].sort((a, b) => {
        const posA = positions.has(a.id) ? (positions.get(a.id) as number) : Number.MAX_SAFE_INTEGER
        const posB = positions.has(b.id) ? (positions.get(b.id) as number) : Number.MAX_SAFE_INTEGER
        return posA - posB
    })
}

const NAV_ORDER_STORAGE_KEY = 'nav_order'
const DEFAULT_NAV_ORDER: ViewKey[] = ['all', 'favourites', 'shared', 'trash']
const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar_width'
const SIDEBAR_HIDDEN_STORAGE_KEY = 'sidebar_hidden'
const MIN_SIDEBAR_WIDTH = 72
const MAX_SIDEBAR_WIDTH = 340
const DEFAULT_SIDEBAR_WIDTH = 240
const COMPACT_SIDEBAR_WIDTH = 128

function clampSidebarWidth(width: number) {
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function loadSidebarWidth() {
    try {
        const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
        return raw ? clampSidebarWidth(Number(raw)) : DEFAULT_SIDEBAR_WIDTH
    } catch {
        return DEFAULT_SIDEBAR_WIDTH
    }
}

function loadSidebarHidden() {
    try {
        return localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

function loadNavOrder(): ViewKey[] {
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

function saveNavOrder(order: ViewKey[]) {
    try {
        localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(order))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

const NAV_LABELS: Record<ViewKey, string> = {
    all: 'All files',
    favourites: 'Favourites',
    shared: 'Shared with me',
    trash: 'Trash',
}

const CIPHER_CHARS = '01#$%&*+=ABCDEF'

function randomCipherChar() {
    return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]
}

function scramble(text: string) {
    return text
        .split('')
        .map((ch) => (ch === '.' ? '.' : randomCipherChar()))
        .join('')
}

function useDecryptReveal(target: string, delayMs: number) {
    const [display, setDisplay] = useState(() => scramble(target))

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>
        const totalFrames = 12
        let frame = 0

        const start = setTimeout(() => {
            interval = setInterval(() => {
                frame += 1
                const revealCount = Math.ceil((frame / totalFrames) * target.length)
                setDisplay(
                    target
                        .split('')
                        .map((ch, i) => (i < revealCount || ch === '.' ? ch : randomCipherChar()))
                        .join(''),
                )
                if (frame >= totalFrames) {
                    clearInterval(interval)
                    setDisplay(target)
                }
            }, 35)
        }, delayMs)

        return () => {
            clearTimeout(start)
            clearInterval(interval)
        }
    }, [target, delayMs])

    return display
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatRelative(iso: string) {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
    return new Date(iso).toLocaleDateString()
}

type FileKind = 'sheet' | 'document' | 'presentation' | 'pdf' | 'archive' | 'video' | 'audio' | 'text' | 'image' | 'code' | 'file'

function kindFromFile(filename: string, mime: string | null): FileKind {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const normalizedMime = mime?.toLowerCase() ?? ''

    if (normalizedMime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image'
    if (normalizedMime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'video'
    if (normalizedMime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
    if (normalizedMime === 'application/pdf' || ext === 'pdf') return 'pdf'
    if (
        normalizedMime.includes('spreadsheet') ||
        normalizedMime.includes('excel') ||
        normalizedMime === 'text/csv' ||
        ['xlsx', 'xls', 'csv', 'ods'].includes(ext)
    ) {
        return 'sheet'
    }
    if (normalizedMime.includes('presentation') || ['ppt', 'pptx', 'odp'].includes(ext)) return 'presentation'
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive'
    if (
        normalizedMime.startsWith('text/') ||
        ['txt', 'md', 'rtf'].includes(ext)
    ) {
        return ['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'rs', 'py', 'java', 'go'].includes(ext) ? 'code' : 'text'
    }
    if (['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'rs', 'py', 'java', 'go', 'xml', 'yaml', 'yml'].includes(ext)) return 'code'
    if (['doc', 'docx', 'odt'].includes(ext) || normalizedMime.includes('wordprocessingml')) return 'document'
    return 'file'
}

const KIND_ACCENT: Record<FileKind, string> = {
    sheet: 'var(--signal)',
    document: 'var(--mist)',
    presentation: 'var(--amber)',
    pdf: '#ff6b6b',
    archive: 'var(--amber)',
    video: 'var(--amber)',
    audio: 'var(--signal)',
    text: 'var(--mist)',
    image: 'var(--signal)',
    code: 'var(--mist)',
    file: 'var(--mist)',
}

const KIND_LABELS: Record<FileKind, string> = {
    sheet: 'Sheets',
    document: 'Docs',
    presentation: 'Slides',
    pdf: 'PDFs',
    archive: 'Archives',
    video: 'Videos',
    audio: 'Audio',
    text: 'Text',
    image: 'Images',
    code: 'Code',
    file: 'Files',
}

function FileIcon({ kind }: { kind: FileKind }) {
    const accent = KIND_ACCENT[kind]
    const common = {
        stroke: accent,
        strokeWidth: '1.4',
        fill: 'none',
    }

    if (kind === 'image') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="14" rx="2" {...common} />
                <circle cx="8.5" cy="9.5" r="1.4" {...common} />
                <path d="M5.5 17l4.2-4.4 3 3 2.1-2.2 3.7 3.6" {...common} />
            </svg>
        )
    }
    if (kind === 'video') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="6" width="12" height="12" rx="2" {...common} />
                <path d="M16 10l4-2.3v8.6L16 14" {...common} />
            </svg>
        )
    }
    if (kind === 'audio') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 17V7l8-2v10" {...common} />
                <circle cx="7" cy="17" r="2" {...common} />
                <circle cx="15" cy="15" r="2" {...common} />
            </svg>
        )
    }
    if (kind === 'archive') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3h12v18H6z" {...common} />
                <path d="M10 3v4h2V3M12 7v4h2V7M10 11v4h2v-4M12 15v3" {...common} />
            </svg>
        )
    }
    if (kind === 'sheet') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" {...common} />
                <path d="M14 2.5V7a1 1 0 0 0 1 1h4.5M8 12h8M8 15h8M11 9v9" {...common} />
            </svg>
        )
    }
    if (kind === 'pdf') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" {...common} />
                <path d="M8 16c1.8-3.3 3.2-6.5 3.1-8.2-.1-1.4-1.8-1.2-1.6.2.3 2.5 2.8 6.8 5.7 7.6 1.3.4 1.8-.9.6-1.3-1.8-.6-5.2.4-7.8 1.7Z" {...common} />
            </svg>
        )
    }
    if (kind === 'code') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8.5 8L5 12l3.5 4M15.5 8L19 12l-3.5 4M13 6.5l-2 11" {...common} />
            </svg>
        )
    }
    if (kind === 'presentation') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v11H4zM12 15v5M8.5 20h7" {...common} />
                <path d="M8 11l2.5-2.5 2 2L16 7" {...common} />
            </svg>
        )
    }

    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
                stroke={accent}
                strokeWidth="1.4"
                fill="none"
            />
            <path d="M14 2.5V7a1 1 0 0 0 1 1h4.5" stroke={accent} strokeWidth="1.4" fill="none" />
        </svg>
    )
}

const NAV_ICONS: Record<ViewKey, React.ReactElement> = {
    all: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 6.5h6l2 2.5h8v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    ),
    shared: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="7" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="17" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="17" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.1 11l5.8-3.6M9.1 13l5.8 3.6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    ),
    trash: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 7h14M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M7 7l1 12.2a1 1 0 0 0 1 .8h6a1 1 0 0 0 1-.8L17 7" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    ),
    favourites: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.4l-5.1 2.8.98-5.68-4.13-4.02 5.7-.83L12 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
            />
        </svg>
    ),
}

const STAR_ICON_FILLED = (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.4l-5.1 2.8.98-5.68-4.13-4.02 5.7-.83L12 3.5Z" />
    </svg>
)

const STAR_ICON_OUTLINE = (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.4l-5.1 2.8.98-5.68-4.13-4.02 5.7-.83L12 3.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
        />
    </svg>
)

const TRASH_OPEN_ICON = (
    <svg className="trash-open-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            className="trash-open-icon__lid"
            d="M8.5 6.5h7M10 4.5h4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
        <path
            d="M6.5 8h11l-.8 11.2a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4L6.5 8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

const DOWNLOAD_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            className="download-icon__arrow"
            d="M12 4v10M8.25 10.25 12 14l3.75-3.75"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            className="download-icon__tray"
            d="M5 18.5h14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
        />
    </svg>
)

const SETTINGS_ICON = (
    <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
)

const DRAG_HANDLE_ICON = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="6" r="1.6" />
        <circle cx="16" cy="6" r="1.6" />
        <circle cx="8" cy="12" r="1.6" />
        <circle cx="16" cy="12" r="1.6" />
        <circle cx="8" cy="18" r="1.6" />
        <circle cx="16" cy="18" r="1.6" />
    </svg>
)

const SIDEBAR_HIDE_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 4.5v15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path
            d="M15.25 8.75 12 12l3.25 3.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

const SIDEBAR_SHOW_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 4.5v15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path
            d="m12.75 8.75 3.25 3.25-3.25 3.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

const GRID_VIEW_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
)

const LIST_VIEW_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="4.5" cy="6" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="18" r="1.2" fill="currentColor" />
    </svg>
)

function isShared(item: Item): item is SharedFile {
    return 'permission' in item
}

function FileCard({
                      item,
                      index,
                      pending,
                      onDelete,
                      onRestore,
                      onDownload,
                      view,
                      isFavourite,
                      onToggleFavourite,
                      draggable,
                      isDragging,
                      isDropTarget,
                      onDragStartCard,
                      onDragEnterCard,
                      onDragLeaveCard,
                      onDropCard,
                      onDragEndCard,
                  }: {
    item: Item
    index: number
    pending: boolean
    onDelete?: (id: string) => void
    onRestore?: (id: string) => void
    onDownload?: (item: Item) => void
    view: ViewKey
    isFavourite?: boolean
    onToggleFavourite?: (id: string) => void
    draggable?: boolean
    isDragging?: boolean
    isDropTarget?: boolean
    onDragStartCard?: (id: string, e: DragEvent<HTMLElement>) => void
    onDragEnterCard?: (id: string) => void
    onDragLeaveCard?: (id: string) => void
    onDropCard?: (id: string, e: DragEvent<HTMLElement>) => void
    onDragEndCard?: () => void
}) {
    const display = useDecryptReveal(item.filename, index * 60)
    const kind = kindFromFile(item.filename, item.mime_type)
    const typeLabel = KIND_LABELS[kind]
    const [favouriteTouched, setFavouriteTouched] = useState(false)
    const canToggleFavourite = Boolean(onToggleFavourite && !isShared(item))
    const canDownload = Boolean(onDownload && view !== 'trash')
    const hasAction = Boolean(canDownload || (view === 'all' && onDelete) || (view === 'trash' && onRestore))

    return (
        <article
            className={`file-card ${canToggleFavourite ? 'file-card--has-favourite' : ''} ${
                hasAction ? 'file-card--has-action' : ''
            } ${isDragging ? 'is-dragging-card' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
            draggable={draggable && !pending}
            onDragStart={(e) => onDragStartCard?.(item.id, e)}
            onDragEnter={(e) => {
                e.preventDefault()
                onDragEnterCard?.(item.id)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => onDragLeaveCard?.(item.id)}
            onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDropCard?.(item.id, e)
            }}
            onDragEnd={() => onDragEndCard?.()}
        >
            {draggable && !pending && (
                <span className="file-card__handle" aria-hidden="true">
                    {DRAG_HANDLE_ICON}
                </span>
            )}
            {canToggleFavourite && (
                <button
                    className={`file-card__fav ${isFavourite ? 'is-active' : ''} ${
                        favouriteTouched ? 'has-favourite-motion' : ''
                    }`}
                    onClick={() => {
                        setFavouriteTouched(true)
                        onToggleFavourite?.(item.id)
                    }}
                    aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                    aria-pressed={isFavourite}
                    type="button"
                >
                    {isFavourite ? STAR_ICON_FILLED : STAR_ICON_OUTLINE}
                </button>
            )}
            <div className="file-card__top">
                <FileIcon kind={kind} />
                {pending ? (
                    <span className="file-card__badge file-card__badge--pending">
            <span className="spinner" /> Encrypting…
          </span>
                ) : isShared(item) ? (
                    <span className="file-card__badge">{item.permissions === 'write' ? 'Can edit' : 'Can view'}</span>
                ) : (
                    <span className="file-card__badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="10.5" width="14" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            AES-256
          </span>
                )}
            </div>
            <p className="file-card__name" title={item.filename}>
                {display}
            </p>
            <p className="file-card__meta">
                {typeLabel} · {formatBytes(item.size_bytes)} · {formatRelative(item.updated_at)}
                {isShared(item) && item.shared_by_user_name ? ` · shared by ${item.shared_by_user_name}` : ''}
            </p>
            {hasAction && (
                <div className="file-card__actions">
                    {canDownload && (
                        <button
                            className="file-card__action file-card__action--download"
                            onClick={() => onDownload?.(item)}
                            aria-label={`Download ${item.filename}`}
                            title="Download"
                            type="button"
                        >
                            {DOWNLOAD_ICON}
                        </button>
                    )}
                    {view === 'all' && onDelete && (
                        <button
                            className="file-card__action file-card__action--trash"
                            onClick={() => onDelete(item.id)}
                            aria-label={`Move ${item.filename} to trash`}
                            title="Move to trash"
                            type="button"
                        >
                            {TRASH_OPEN_ICON}
                        </button>
                    )}
                    {view === 'trash' && onRestore && (
                        <button className="file-card__action" onClick={() => onRestore(item.id)}>
                            Restore
                        </button>
                    )}
                </div>
            )}
        </article>
    )
}

function EmptyPane({ title, body }: { title: string; body: string }) {
    return (
        <div className="empty-pane">
            <p className="empty-pane__title">{title}</p>
            <p className="empty-pane__body">{body}</p>
        </div>
    )
}

function Dashboard() {
    const [view, setView] = useState<ViewKey>('all')
    const [items, setItems] = useState<Item[]>([])
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [quota, setQuota] = useState<StorageQuota | null>(null)
    const [storageItems, setStorageItems] = useState<ApiFile[]>([])
    const [query, setQuery] = useState('')
    const [menuOpen, setMenuOpen] = useState(false)
    const [dragActive, setDragActive] = useState(false)
    const [favouriteIds, setFavouriteIds] = useState<Set<string>>(() => loadFavouriteIds())
    const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const [navOrder, setNavOrder] = useState<ViewKey[]>(() => loadNavOrder())
    const [draggedNavKey, setDraggedNavKey] = useState<ViewKey | null>(null)
    const [dropNavTarget, setDropNavTarget] = useState<ViewKey | null>(null)
    const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth())
    const [sidebarHidden, setSidebarHidden] = useState(() => loadSidebarHidden())
    const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => loadLayoutMode())
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const navListRef = useRef<HTMLElement>(null)
    const navItemRefs = useRef<Partial<Record<ViewKey, HTMLButtonElement>>>({})
    const [navIndicator, setNavIndicator] = useState<NavIndicator>({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
    })
    const [navIndicatorPulling, setNavIndicatorPulling] = useState(false)

    // TODO: replace with a real "current user" fetch once api/users.ts exposes one.
    const displayName = useMemo(() => {
        return localStorage.getItem('display_name') || sessionStorage.getItem('display_name') || 'You'
    }, [])

    const refreshQuota = async () => {
        try {
            const [quotaData, fileData] = await Promise.all([getStorageQuota(), listFiles()])
            setQuota(quotaData)
            setStorageItems(applyLocalFileMetadata(fileData))
        } catch {
            setQuota(null)
        }
    }

    useEffect(() => {
        void refreshQuota()
    }, [])

    useEffect(() => {
        let active = true
        getCurrentUser()
            .then((user) => {
                if (active) setPublicKey(user.public_key)
            })
            .catch(() => {
                if (active) setPublicKey(null)
            })

        return () => {
            active = false
        }
    }, [])

    useLayoutEffect(() => {
        function updateNavIndicator() {
            const nav = navListRef.current
            const activeItem = navItemRefs.current[view]
            if (!nav || !activeItem || sidebarHidden) {
                setNavIndicator((prev) => ({ ...prev, visible: false }))
                return
            }

            const navRect = nav.getBoundingClientRect()
            const itemRect = activeItem.getBoundingClientRect()
            setNavIndicator({
                x: itemRect.left - navRect.left,
                y: itemRect.top - navRect.top,
                width: itemRect.width,
                height: itemRect.height,
                visible: true,
            })
        }

        updateNavIndicator()
        window.addEventListener('resize', updateNavIndicator)
        return () => window.removeEventListener('resize', updateNavIndicator)
    }, [view, navOrder, sidebarWidth, sidebarHidden])

    useEffect(() => {
        setNavIndicatorPulling(false)
        const frame = requestAnimationFrame(() => setNavIndicatorPulling(true))
        const timeout = window.setTimeout(() => setNavIndicatorPulling(false), 540)

        return () => {
            cancelAnimationFrame(frame)
            window.clearTimeout(timeout)
        }
    }, [view])

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
        } catch {
            // ignore storage failures (e.g. private browsing)
        }
    }, [sidebarWidth])

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(sidebarHidden))
        } catch {
            // ignore storage failures (e.g. private browsing)
        }
    }, [sidebarHidden])

    useEffect(() => {
        let active = true

        Promise.resolve()
            .then(() => {
                if (!active) return undefined
                setLoading(true)
                setError(null)
                return view === 'all' || view === 'favourites'
                    ? listFiles()
                    : view === 'trash'
                        ? listTrash()
                        : listSharedFilesWithMe()
            })
            .then((data) => {
                if (active && data) {
                    const withLocalMetadata = applyLocalFileMetadata(data)
                    setItems(applySavedOrder(withLocalMetadata, view))
                    if (view === 'all' || view === 'favourites') {
                        setStorageItems(withLocalMetadata as ApiFile[])
                    }
                }
            })
            .catch((e) => {
                if (active) setError(e instanceof Error ? e.message : 'Could not load your files.')
            })
            .finally(() => {
                if (active) setLoading(false)
            })

        return () => {
            active = false
        }
    }, [view])

    useEffect(() => {
        function onClickAway(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', onClickAway)
        return () => document.removeEventListener('mousedown', onClickAway)
    }, [])

    async function ingestFiles(fileList: FileList) {
        for (const file of Array.from(fileList)) {
            const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
            const now = new Date().toISOString()
            const placeholder: ApiFile = {
                id: tempId,
                filename: file.name,
                storage_path: '',
                mime_type: file.type || null,
                size_bytes: file.size,
                folder_id: null,
                is_deleted: false,
                is_public: false,
                share_token: null,
                created_at: now,
                updated_at: now,
                deleted_at: null,
            }

            setItems((prev) => [placeholder, ...prev])
            setPendingIds((prev) => new Set(prev).add(tempId))

            try {
                if (!publicKey) {
                    throw new Error('Encryption key unavailable. Sign in again before uploading.')
                }

                const key = await generateFileKey()
                const { ciphertext, nonce } = await encryptFile(file, key)
                const wrappedKey = await wrapFileKeyForUser(key, publicKey)
                const originalMimeType = file.type || null
                const encryptedBlob = new Blob([ciphertext], { type: originalMimeType || 'application/octet-stream' })

                const saved = await uploadFile({
                    encryptedFile: encryptedBlob,
                    originalFilename: file.name,
                    originalMimeType,
                    wrappedKey,
                    encryptionNonce: nonce.buffer as ArrayBuffer,
                })

                const visibleSaved = {
                    ...saved,
                    filename: file.name,
                    mime_type: file.type || null,
                }
                saveLocalFileMetadata(saved.id, {
                    filename: file.name,
                    mime_type: file.type || null,
                })
                setItems((prev) => prev.map((i) => (i.id === tempId ? visibleSaved : i)))
            } catch (e) {
                setItems((prev) => prev.filter((i) => i.id !== tempId))
                setError(e instanceof Error ? e.message : `Failed to upload ${file.name}.`)
            } finally {
                setPendingIds((prev) => {
                    const next = new Set(prev)
                    next.delete(tempId)
                    return next
                })
            }
        }

        await refreshQuota()
    }

    function onUploadChange(e: ChangeEvent<HTMLInputElement>) {
        if (e.target.files && e.target.files.length > 0) {
            void ingestFiles(e.target.files)
            e.target.value = ''
        }
    }

    function isFileDrag(e: DragEvent<HTMLDivElement>) {
        return Array.from(e.dataTransfer.types).includes('Files')
    }

    function onDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault()
        setDragActive(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            void ingestFiles(e.dataTransfer.files)
        }
    }

    async function handleDelete(id: string) {
        setItems((prev) => prev.filter((i) => i.id !== id))
        try {
            await softDeleteFile(id)
            await refreshQuota()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not move that file to trash.')
        }
    }

    async function handleRestore(id: string) {
        setItems((prev) => prev.filter((i) => i.id !== id))
        try {
            await restoreFile(id)
            await refreshQuota()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not restore that file.')
        }
    }

    async function handleDownload(item: Item) {
        try {
            const blob = await downloadFile(item.id)
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = item.filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not download that file.')
        }
    }

    function toggleFavourite(id: string) {
        setFavouriteIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            saveFavouriteIds(next)
            return next
        })
    }

    function changeLayoutMode(mode: LayoutMode) {
        setLayoutMode(mode)
        saveLayoutMode(mode)
    }

    function handleCardDragStart(id: string, e: DragEvent<HTMLElement>) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
        setDraggedCardId(id)
    }

    function handleCardDragEnter(id: string) {
        if (id !== draggedCardId) setDropTargetId(id)
    }

    function handleCardDragLeave(id: string) {
        setDropTargetId((prev) => (prev === id ? null : prev))
    }

    function handleCardDrop(targetId: string, e: DragEvent<HTMLElement>) {
        const sourceId = e.dataTransfer.getData('text/plain') || draggedCardId
        setDraggedCardId(null)
        setDropTargetId(null)
        if (!sourceId || sourceId === targetId) return

        setItems((prev) => {
            const arr = [...prev]
            const fromIdx = arr.findIndex((i) => i.id === sourceId)
            const toIdx = arr.findIndex((i) => i.id === targetId)
            if (fromIdx === -1 || toIdx === -1) return prev
            const [moved] = arr.splice(fromIdx, 1)
            arr.splice(toIdx, 0, moved)
            saveOrderIds(view, arr.map((i) => i.id))
            return arr
        })
    }

    function handleCardDragEnd() {
        setDraggedCardId(null)
        setDropTargetId(null)
    }

    function handleNavDragStart(key: ViewKey, e: DragEvent<HTMLElement>) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', key)
        setDraggedNavKey(key)
    }

    function handleNavDragEnter(key: ViewKey) {
        if (key !== draggedNavKey) setDropNavTarget(key)
    }

    function handleNavDragLeave(key: ViewKey) {
        setDropNavTarget((prev) => (prev === key ? null : prev))
    }

    function handleNavDrop(targetKey: ViewKey, e: DragEvent<HTMLElement>) {
        const sourceKey = (e.dataTransfer.getData('text/plain') as ViewKey) || draggedNavKey
        setDraggedNavKey(null)
        setDropNavTarget(null)
        if (!sourceKey || sourceKey === targetKey) return

        setNavOrder((prev) => {
            const arr = [...prev]
            const fromIdx = arr.indexOf(sourceKey)
            const toIdx = arr.indexOf(targetKey)
            if (fromIdx === -1 || toIdx === -1) return prev
            const [moved] = arr.splice(fromIdx, 1)
            arr.splice(toIdx, 0, moved)
            saveNavOrder(arr)
            return arr
        })
    }

    function handleNavDragEnd() {
        setDraggedNavKey(null)
        setDropNavTarget(null)
    }

    function startSidebarResize(e: ReactMouseEvent<HTMLButtonElement>) {
        e.preventDefault()
        setSidebarHidden(false)

        function onMove(event: MouseEvent) {
            setSidebarWidth(clampSidebarWidth(event.clientX))
        }

        function onUp() {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            document.body.classList.remove('is-resizing-sidebar')
        }

        document.body.classList.add('is-resizing-sidebar')
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    async function signOut() {
        await logout()
        window.location.href = '/login'
    }

    const visibleItems = items
        .filter((i) => i.filename.toLowerCase().includes(query.trim().toLowerCase()))
        .filter((i) => (view === 'favourites' ? favouriteIds.has(i.id) : true))

    const usedPct = quota ? Math.min(100, Math.round((quota.used_bytes / quota.total_bytes) * 100)) : 0
    const storageStatus = usedPct >= 90 ? 'critical' : usedPct >= 80 ? 'warning' : 'healthy'
    const storageStatusText =
        storageStatus === 'critical'
            ? 'Storage almost full'
            : storageStatus === 'warning'
                ? 'Storage getting full'
                : 'Plenty of room'
    const storageBreakdown = Object.entries(
        storageItems.reduce(
            (acc, item) => {
                const kind = kindFromFile(item.filename, item.mime_type)
                acc[kind] = (acc[kind] ?? 0) + item.size_bytes
                return acc
            },
            {} as Record<FileKind, number>,
        ),
    )
        .map(([kind, bytes]) => ({
            kind: kind as FileKind,
            bytes,
        }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 4)
    const storageBreakdownTotal = storageBreakdown.reduce((sum, item) => sum + item.bytes, 0)
    const sidebarCompact = !sidebarHidden && sidebarWidth <= COMPACT_SIDEBAR_WIDTH

    return (
        <div
            className={`shell ${sidebarHidden ? 'is-sidebar-hidden' : ''} ${sidebarCompact ? 'is-sidebar-compact' : ''}`}
            style={{ '--sidebar-width': sidebarHidden ? '0px' : `${sidebarWidth}px` } as React.CSSProperties}
        >
            <aside className="shell__sidebar" aria-hidden={sidebarHidden}>
                <Link to="/" className="shell__logo">
                    <span className="nav__logo-mark" aria-hidden="true" />
                    <span className="shell__sidebar-label">SkysyncR</span>
                </Link>

                <button
                    className="shell__sidebar-toggle"
                    type="button"
                    onClick={() => setSidebarHidden(true)}
                    aria-label="Hide navigation"
                    title="Hide navigation"
                >
                    {SIDEBAR_HIDE_ICON}
                </button>

                <button
                    className="shell__resize-handle"
                    type="button"
                    onMouseDown={startSidebarResize}
                    aria-label="Resize navigation"
                    title="Drag to resize navigation"
                />

                <nav
                    className="shell__navlist shell__navlist--primary"
                    ref={navListRef}
                    style={
                        {
                            '--nav-indicator-x': `${navIndicator.x}px`,
                            '--nav-indicator-y': `${navIndicator.y}px`,
                            '--nav-indicator-width': `${navIndicator.width}px`,
                            '--nav-indicator-height': `${navIndicator.height}px`,
                            '--nav-indicator-opacity': navIndicator.visible ? 1 : 0,
                        } as React.CSSProperties
                    }
                >
                    <span
                        className={`shell__nav-indicator ${navIndicatorPulling ? 'is-pulling' : ''}`}
                        aria-hidden="true"
                    />
                    {navOrder.map((key) => (
                        <button
                            key={key}
                            ref={(node) => {
                                if (node) {
                                    navItemRefs.current[key] = node
                                } else {
                                    delete navItemRefs.current[key]
                                }
                            }}
                            className={`shell__navitem ${view === key ? 'is-active' : ''} ${
                                draggedNavKey === key ? 'is-dragging-nav' : ''
                            } ${dropNavTarget === key ? 'is-drop-target-nav' : ''}`}
                            onClick={() => setView(key)}
                            draggable
                            onDragStart={(e) => handleNavDragStart(key, e)}
                            onDragEnter={(e) => {
                                e.preventDefault()
                                handleNavDragEnter(key)
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDragLeave={() => handleNavDragLeave(key)}
                            onDrop={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleNavDrop(key, e)
                            }}
                            onDragEnd={handleNavDragEnd}
                        >
                            <span className="shell__navicon shell__navicon--handle">{DRAG_HANDLE_ICON}</span>
                            <span className="shell__navicon">{NAV_ICONS[key]}</span>
                            <span className="shell__sidebar-label">{NAV_LABELS[key]}</span>
                        </button>
                    ))}
                </nav>

                <nav className="shell__navlist shell__navlist--footer">
                    <Link to="/settings" className="shell__navitem">
                        <span className="shell__navicon">{SETTINGS_ICON}</span>
                        <span className="shell__sidebar-label">Settings</span>
                    </Link>
                </nav>

                <div className="shell__storage">
                    <div className="shell__storage-row">
                        <span>Storage</span>
                        <span>
              {quota ? `${formatBytes(quota.used_bytes)} / ${formatBytes(quota.total_bytes)}` : '—'}
            </span>
                    </div>
                    <div className="shell__storage-summary">
                        <strong>{quota ? `${usedPct}% used` : 'Quota unavailable'}</strong>
                        <span className={`shell__storage-status shell__storage-status--${storageStatus}`}>
                            {quota ? storageStatusText : 'Check connection'}
                        </span>
                    </div>
                    <div className="shell__storage-bar">
                        <div
                            className={`shell__storage-fill shell__storage-fill--${storageStatus}`}
                            style={{ width: `${usedPct}%` }}
                        />
                    </div>
                    <div className="shell__storage-breakdown" aria-label="Storage by file type">
                        {storageBreakdown.length > 0 ? (
                            storageBreakdown.map((item) => {
                                const percent = storageBreakdownTotal
                                    ? Math.max(3, Math.round((item.bytes / storageBreakdownTotal) * 100))
                                    : 0
                                return (
                                    <div className="shell__storage-type" key={item.kind}>
                                        <div className="shell__storage-type-row">
                                            <span>{KIND_LABELS[item.kind]}</span>
                                            <span>{formatBytes(item.bytes)}</span>
                                        </div>
                                        <div className="shell__storage-type-bar">
                                            <div
                                                className="shell__storage-type-fill"
                                                style={{
                                                    width: `${percent}%`,
                                                    background: KIND_ACCENT[item.kind],
                                                }}
                                            />
                                        </div>
                                    </div>
                                )
                            })
                        ) : (
                            <p className="shell__storage-empty">No files counted yet</p>
                        )}
                    </div>
                </div>
            </aside>

            <div className="shell__main">
                <header className="shell__topbar">
                    {sidebarHidden && (
                        <button
                            className="shell__show-sidebar"
                            type="button"
                            onClick={() => setSidebarHidden(false)}
                            aria-label="Show navigation"
                            title="Show navigation"
                        >
                            {SIDEBAR_SHOW_ICON}
                        </button>
                    )}
                    <label className="shell__search">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                            <path d="M20 20l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search your vault…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </label>

                    <div className="shell__topbar-actions">
            <span className="shell__sync">
              <span className="eyebrow__dot" /> synced · encrypted
            </span>

                        <ThemeToggle className="shell__theme-toggle" />

                        <div className="shell__user" ref={menuRef}>
                            <button
                                className="shell__avatar"
                                onClick={() => setMenuOpen((v) => !v)}
                                aria-label="Account menu"
                            >
                                {displayName.charAt(0).toUpperCase()}
                            </button>
                            {menuOpen && (
                                <div className="shell__menu">
                                    <p className="shell__menu-name">{displayName}</p>
                                    <button className="shell__menu-item" onClick={signOut}>
                                        Sign out
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div
                    className={`shell__content ${dragActive ? 'is-dragging' : ''}`}
                    onDragOver={(e) => {
                        if (!isFileDrag(e)) return
                        e.preventDefault()
                        setDragActive(true)
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => {
                        if (!isFileDrag(e)) return
                        onDrop(e)
                    }}
                >
                    <div className="shell__content-head">
                        <div>
                            <p className="eyebrow">
                                <span className="eyebrow__dot" /> vault unlocked
                            </p>
                            <h1 className="shell__title">
                                {view === 'all' && 'All files'}
                                {view === 'favourites' && 'Favourites'}
                                {view === 'shared' && 'Shared with me'}
                                {view === 'trash' && 'Trash'}
                            </h1>
                        </div>

                        <div className="shell__content-actions">
                            <div className="view-toggle" role="group" aria-label="File layout">
                                <button
                                    className={`view-toggle__button ${layoutMode === 'grid' ? 'is-active' : ''}`}
                                    type="button"
                                    onClick={() => changeLayoutMode('grid')}
                                    aria-label="Grid view"
                                    aria-pressed={layoutMode === 'grid'}
                                    title="Grid view"
                                >
                                    {GRID_VIEW_ICON}
                                </button>
                                <button
                                    className={`view-toggle__button ${layoutMode === 'list' ? 'is-active' : ''}`}
                                    type="button"
                                    onClick={() => changeLayoutMode('list')}
                                    aria-label="List view"
                                    aria-pressed={layoutMode === 'list'}
                                    title="List view"
                                >
                                    {LIST_VIEW_ICON}
                                </button>
                            </div>

                            {view === 'all' && (
                                <label className="btn btn--solid">
                                    Upload
                                    <input type="file" multiple onChange={onUploadChange} style={{ display: 'none' }} />
                                </label>
                            )}
                        </div>
                    </div>

                    {error && (
                        <p className="shell__error" role="alert">
                            {error}
                        </p>
                    )}

                    {loading && <p className="shell__loading">Loading…</p>}

                    {!loading && view === 'shared' && visibleItems.length === 0 && (
                        <EmptyPane
                            title="Nothing shared yet"
                            body="Files someone shares with you will show up here, still encrypted end-to-end."
                        />
                    )}

                    {!loading && view === 'favourites' && visibleItems.length === 0 && (
                        <EmptyPane
                            title={query ? 'No favourites match your search' : 'No favourites yet'}
                            body="Tap the star on any file to pin it here for quick access."
                        />
                    )}

                    {!loading && view === 'trash' && visibleItems.length === 0 && (
                        <EmptyPane
                            title="Trash is empty"
                            body="Deleted files stay here for 30 days before they're gone for good."
                        />
                    )}

                    {!loading && view === 'all' && visibleItems.length === 0 && (
                        <EmptyPane
                            title={query ? 'No files match your search' : 'Drop files to encrypt and sync'}
                            body={
                                query
                                    ? 'Try a different name, or clear the search to see everything.'
                                    : 'Files are locked with AES-256 on this device before they ever reach the network.'
                            }
                        />
                    )}

                    {!loading && visibleItems.length > 0 && (
                        <div className={`file-grid file-grid--${layoutMode}`}>
                            {visibleItems.map((item, i) => (
                                <FileCard
                                    key={item.id}
                                    item={item}
                                    index={i}
                                    pending={pendingIds.has(item.id)}
                                    view={view}
                                    onDelete={view === 'all' ? handleDelete : undefined}
                                    onRestore={view === 'trash' ? handleRestore : undefined}
                                    onDownload={view !== 'trash' ? handleDownload : undefined}
                                    isFavourite={favouriteIds.has(item.id)}
                                    onToggleFavourite={
                                        view === 'all' || view === 'favourites' ? toggleFavourite : undefined
                                    }
                                    draggable={!pendingIds.has(item.id)}
                                    isDragging={draggedCardId === item.id}
                                    isDropTarget={dropTargetId === item.id}
                                    onDragStartCard={handleCardDragStart}
                                    onDragEnterCard={handleCardDragEnter}
                                    onDragLeaveCard={handleCardDragLeave}
                                    onDropCard={handleCardDrop}
                                    onDragEndCard={handleCardDragEnd}
                                />
                            ))}
                        </div>
                    )}

                    {dragActive && (
                        <div className="dropzone-overlay">
                            <p>Drop to encrypt &amp; upload</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default Dashboard
