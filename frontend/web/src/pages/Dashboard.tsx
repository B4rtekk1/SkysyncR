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

type ViewKey = 'all' | 'favourites' | 'shared' | 'groups' | 'trash'
type LayoutMode = 'grid' | 'list'
type Item = ApiFile | SharedFile
type GroupInviteRole = 'viewer' | 'editor' | 'admin'

type GroupInvite = {
    id: string
    email: string
    role: GroupInviteRole
    createdAt: string
}

type Group = {
    id: string
    name: string
    defaultRole: GroupInviteRole
    createdAt: string
    invites: GroupInvite[]
}

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
const GROUPS_STORAGE_KEY = 'groups'
const LEGACY_GROUP_INVITES_STORAGE_KEY = 'group_invites'

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

function loadGroups(): Group[] {
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

function saveGroups(groups: Group[]) {
    try {
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups))
    } catch {
        // ignore storage failures (e.g. private browsing)
    }
}

const ORDER_STORAGE_PREFIX = 'file_order_'
const SEARCH_FILTER_EXIT_MS = 240
const LAYOUT_SWITCH_MS = 420

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
const DEFAULT_NAV_ORDER: ViewKey[] = ['all', 'favourites', 'shared', 'groups', 'trash']
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
    groups: 'Groups',
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
    text: 'var(--signal)',
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

const DOCUMENT_ICON_PATH = 'M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z'
const DOCUMENT_FOLD_PATH = 'M14 2.5V7a1 1 0 0 0 1 1h4.5'

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
                <path d={DOCUMENT_ICON_PATH} {...common} />
                <path d={`${DOCUMENT_FOLD_PATH}M8 12h8M8 15h8M11 9v9`} {...common} />
            </svg>
        )
    }
    if (kind === 'pdf') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d={DOCUMENT_ICON_PATH} {...common} />
                <path d="M8 16c1.8-3.3 3.2-6.5 3.1-8.2-.1-1.4-1.8-1.2-1.6.2.3 2.5 2.8 6.8 5.7 7.6 1.3.4 1.8-.9.6-1.3-1.8-.6-5.2.4-7.8 1.7Z" {...common} />
            </svg>
        )
    }
    if (kind === 'text') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d={DOCUMENT_ICON_PATH} {...common} />
                <path d={DOCUMENT_FOLD_PATH} {...common} />
                <path d="M8 11h4.2M14.2 11H16M8 14h8M8 17h3.6M13.5 17H16" {...common} strokeLinecap="round" />
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
                d={DOCUMENT_ICON_PATH}
                stroke={accent}
                strokeWidth="1.4"
                fill="none"
            />
            <path d={DOCUMENT_FOLD_PATH} stroke={accent} strokeWidth="1.4" fill="none" />
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
    groups: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="8" cy="8.5" r="2.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="16.5" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <path
                d="M3.8 18.5c.6-2.9 2.4-4.6 4.2-4.6s3.6 1.7 4.2 4.6M13.5 17.8c.5-2 1.7-3.1 3-3.1s2.5 1.1 3 3.1"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
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
                      isSearchExiting,
                      style,
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
    isSearchExiting?: boolean
    style?: React.CSSProperties
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
            } ${isDragging ? 'is-dragging-card' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${
                isSearchExiting ? 'is-search-exiting' : ''
            }`}
            style={style}
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

function GroupsPanel({
    groups,
    activeGroupId,
    createOpen,
    inviteOpen,
    onCreateGroup,
    onOpenCreate,
    onCloseCreate,
    onOpenGroup,
    onBackToGroups,
    onOpenInvite,
    onCloseInvite,
    onInvite,
    onRemoveInvite,
    onUpdateGroup,
    onDeleteGroup,
}: {
    groups: Group[]
    activeGroupId: string | null
    createOpen: boolean
    inviteOpen: boolean
    onCreateGroup: (name: string, defaultRole: GroupInviteRole) => void
    onOpenCreate: () => void
    onCloseCreate: () => void
    onOpenGroup: (id: string) => void
    onBackToGroups: () => void
    onOpenInvite: () => void
    onCloseInvite: () => void
    onInvite: (groupId: string, email: string, role: GroupInviteRole) => void
    onRemoveInvite: (groupId: string, inviteId: string) => void
    onUpdateGroup: (groupId: string, name: string, defaultRole: GroupInviteRole) => void
    onDeleteGroup: (groupId: string) => void
}) {
    const [email, setEmail] = useState('')
    const [role, setRole] = useState<GroupInviteRole>('viewer')
    const [groupName, setGroupName] = useState('')
    const [defaultRole, setDefaultRole] = useState<GroupInviteRole>('viewer')
    const [settingsName, setSettingsName] = useState('')
    const [settingsRole, setSettingsRole] = useState<GroupInviteRole>('viewer')
    const [formError, setFormError] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)
    const [settingsError, setSettingsError] = useState<string | null>(null)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const activeGroup = activeGroupId ? groups.find((group) => group.id === activeGroupId) ?? null : null

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        if (activeGroup && inviteOpen) {
            timeout = setTimeout(() => setRole(activeGroup.defaultRole), 0)
        }

        return () => {
            if (timeout) clearTimeout(timeout)
        }
    }, [activeGroup, inviteOpen])

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        if (activeGroup) {
            timeout = setTimeout(() => {
                setSettingsName(activeGroup.name)
                setSettingsRole(activeGroup.defaultRole)
                setSettingsError(null)
                setDeleteConfirmOpen(false)
            }, 0)
        }

        return () => {
            if (timeout) clearTimeout(timeout)
        }
    }, [activeGroup])

    function submitSettings(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!activeGroup) return

        const normalizedName = settingsName.trim()

        if (normalizedName.length < 2) {
            setSettingsError('Enter a group name.')
            return
        }

        if (
            groups.some(
                (group) => group.id !== activeGroup.id && group.name.toLowerCase() === normalizedName.toLowerCase(),
            )
        ) {
            setSettingsError('A group with this name already exists.')
            return
        }

        onUpdateGroup(activeGroup.id, normalizedName, settingsRole)
        setSettingsError(null)
    }

    function submitGroup(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const normalizedName = groupName.trim()

        if (normalizedName.length < 2) {
            setCreateError('Enter a group name.')
            return
        }

        if (groups.some((group) => group.name.toLowerCase() === normalizedName.toLowerCase())) {
            setCreateError('A group with this name already exists.')
            return
        }

        onCreateGroup(normalizedName, defaultRole)
        setGroupName('')
        setDefaultRole('viewer')
        setCreateError(null)
        onCloseCreate()
    }

    function closeCreate() {
        setGroupName('')
        setDefaultRole('viewer')
        setCreateError(null)
        onCloseCreate()
    }

    function submitInvite(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!activeGroup) return

        const normalizedEmail = email.trim().toLowerCase()

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            setFormError('Enter a valid email address.')
            return
        }

        if (activeGroup.invites.some((invite) => invite.email === normalizedEmail)) {
            setFormError('This person is already invited.')
            return
        }

        onInvite(activeGroup.id, normalizedEmail, role)
        setEmail('')
        setRole('viewer')
        setFormError(null)
        onCloseInvite()
    }

    function closeInvite() {
        setEmail('')
        setRole('viewer')
        setFormError(null)
        onCloseInvite()
    }

    if (activeGroup) {
        return (
            <>
                <section className="groups-panel" aria-label={`${activeGroup.name} group`}>
                    <div className="groups-panel__head groups-panel__head--detail">
                        <div className="groups-hero">
                            <button className="groups-panel__back" type="button" onClick={onBackToGroups}>
                                <span aria-hidden="true">←</span> All groups
                            </button>
                            <div className="groups-hero__identity">
                                <div className="groups-hero__mark" aria-hidden="true">{activeGroup.name.charAt(0).toUpperCase()}</div>
                                <div>
                                    <p className="groups-panel__eyebrow">Shared workspace</p>
                                    <h2 className="groups-panel__title">{activeGroup.name}</h2>
                                </div>
                            </div>
                        </div>
                        <button className="btn btn--solid" type="button" onClick={onOpenInvite}>
                            <span aria-hidden="true">+</span> Invite member
                        </button>
                    </div>

                    <div className="groups-summary">
                        <div className="groups-summary__item">
                            <span className="groups-summary__icon" aria-hidden="true">+</span>
                            <div>
                                <strong>{activeGroup.invites.length}</strong>
                                <span>Pending invitations</span>
                            </div>
                        </div>
                        <div className="groups-summary__item">
                            <span className="groups-summary__icon" aria-hidden="true">•</span>
                            <div>
                                <strong>{formatRelative(activeGroup.createdAt)}</strong>
                                <span>Created</span>
                            </div>
                        </div>
                        <div className="groups-summary__item">
                            <span className="groups-summary__icon" aria-hidden="true">✓</span>
                            <div>
                                <strong className={`groups-role groups-role--${activeGroup.defaultRole}`}>{activeGroup.defaultRole}</strong>
                                <span>Default access</span>
                            </div>
                        </div>
                    </div>

                    <form className="groups-settings" onSubmit={submitSettings}>
                        <div className="groups-settings__head">
                            <div>
                                <p className="groups-panel__eyebrow">Settings</p>
                                <h3 className="groups-settings__title">Group settings</h3>
                            </div>
                            <button className="btn btn--outline" type="submit">
                                Save changes
                            </button>
                        </div>

                        <div className="groups-settings__grid">
                            <label className="groups-invite__field">
                                <span>Group name</span>
                                <input
                                    type="text"
                                    value={settingsName}
                                    onChange={(e) => setSettingsName(e.target.value)}
                                />
                            </label>
                            <label className="groups-invite__field">
                                <span>Default user role</span>
                                <select
                                    value={settingsRole}
                                    onChange={(e) => setSettingsRole(e.target.value as GroupInviteRole)}
                                >
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </label>
                        </div>

                        {settingsError && (
                            <p className="groups-invite__error" role="alert">
                                {settingsError}
                            </p>
                        )}

                        <div className="groups-danger">
                            <div>
                                <strong>Delete group</strong>
                                <span>Removes the group and all pending invitations from this device.</span>
                            </div>
                            {deleteConfirmOpen ? (
                                <div className="groups-danger__actions">
                                    <button
                                        className="btn btn--ghost"
                                        type="button"
                                        onClick={() => setDeleteConfirmOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="groups-danger__delete"
                                        type="button"
                                        onClick={() => onDeleteGroup(activeGroup.id)}
                                    >
                                        Confirm delete
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="groups-danger__delete"
                                    type="button"
                                    onClick={() => setDeleteConfirmOpen(true)}
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </form>

                    <div className="groups-members">
                        <div className="groups-members__head">
                            <div>
                                <p className="groups-panel__eyebrow">Access</p>
                                <h3>Pending members</h3>
                            </div>
                            <span className="groups-members__count">{activeGroup.invites.length}</span>
                        </div>
                    <div className="groups-invites">
                        {activeGroup.invites.length > 0 ? (
                            activeGroup.invites.map((invite) => (
                                <div className="groups-invites__row" key={invite.id}>
                                    <div className="groups-invites__avatar" aria-hidden="true">
                                        {invite.email.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="groups-invites__person">
                                        <strong>{invite.email}</strong>
                                        <span>Invited {formatRelative(invite.createdAt)}</span>
                                    </div>
                                    <span className={`groups-role groups-role--${invite.role}`}>{invite.role}</span>
                                    <button
                                        className="groups-invites__remove"
                                        type="button"
                                        onClick={() => onRemoveInvite(activeGroup.id, invite.id)}
                                        aria-label={`Cancel invitation for ${invite.email}`}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="groups-invites__empty">No invitations yet. Add the first member to start collaborating.</p>
                        )}
                    </div>
                    </div>
                </section>

                {inviteOpen && (
                    <div className="groups-modal" role="presentation" onMouseDown={closeInvite}>
                        <form
                            className="groups-modal__dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-label={`Invite member to ${activeGroup.name}`}
                            onSubmit={submitInvite}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="groups-modal__head">
                                <div>
                                    <p className="groups-panel__eyebrow">Invite member</p>
                                    <h3 className="groups-modal__title">{activeGroup.name}</h3>
                                </div>
                                <button
                                    className="groups-modal__close"
                                    type="button"
                                    onClick={closeInvite}
                                    aria-label="Close invite dialog"
                                >
                                    x
                                </button>
                            </div>

                            <label className="groups-invite__field">
                                <span>Email</span>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="name@example.com"
                                    autoFocus
                                />
                            </label>
                            <label className="groups-invite__field">
                                <span>Role</span>
                                <select value={role} onChange={(e) => setRole(e.target.value as GroupInviteRole)}>
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </label>

                            {formError && (
                                <p className="groups-invite__error" role="alert">
                                    {formError}
                                </p>
                            )}

                            <div className="groups-modal__actions">
                                <button className="btn btn--outline" type="button" onClick={closeInvite}>
                                    Cancel
                                </button>
                                <button className="btn btn--solid" type="submit">
                                    Send invite
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </>
        )
    }

    return (
        <>
            <section className="groups-panel" aria-label="Groups">
                <div className="groups-panel__head groups-panel__head--listing">
                    <div>
                        <p className="groups-panel__eyebrow">Collaboration spaces</p>
                        <h2 className="groups-panel__title">Your groups</h2>
                        <p className="groups-panel__subtitle">Create private spaces and manage access to your shared vault.</p>
                    </div>
                    <button className="btn btn--solid" type="button" onClick={onOpenCreate}>
                        <span aria-hidden="true">+</span> New group
                    </button>
                </div>

                {groups.length > 0 ? (
                    <div className="groups-list">
                        {groups.map((group) => (
                            <button
                                className="groups-list__item"
                                key={group.id}
                                type="button"
                                onClick={() => onOpenGroup(group.id)}
                            >
                                <div className="groups-list__mark" aria-hidden="true">{group.name.charAt(0).toUpperCase()}</div>
                                <div className="groups-list__body">
                                    <div className="groups-list__title-row"><strong>{group.name}</strong><span className={`groups-role groups-role--${group.defaultRole}`}>{group.defaultRole}</span></div>
                                    <div className="groups-list__meta">
                                        <span>{group.invites.length === 1 ? '1 pending invitation' : `${group.invites.length} pending invitations`}</span>
                                        <span>Created {formatRelative(group.createdAt)}</span>
                                    </div>
                                </div>
                                <span className="groups-list__chevron" aria-hidden="true">→</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="groups-empty">
                        <div className="groups-empty__icon" aria-hidden="true">+</div>
                        <p className="empty-pane__title">Create your first group</p>
                        <p className="empty-pane__body">Give your team a private shared space with access you control.</p>
                        <button className="btn btn--solid" type="button" onClick={onOpenCreate}>Create group</button>
                    </div>
                )}
            </section>

            {createOpen && (
                <div className="groups-modal" role="presentation" onMouseDown={closeCreate}>
                    <form
                        className="groups-modal__dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Create group"
                        onSubmit={submitGroup}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="groups-modal__head">
                            <div>
                                <p className="groups-panel__eyebrow">New group</p>
                                <h3 className="groups-modal__title">Create group</h3>
                            </div>
                            <button
                                className="groups-modal__close"
                                type="button"
                                onClick={closeCreate}
                                aria-label="Close group dialog"
                            >
                                x
                            </button>
                        </div>

                        <label className="groups-invite__field">
                            <span>Group name</span>
                            <input
                                type="text"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                placeholder="Design team"
                                autoFocus
                            />
                        </label>
                        <label className="groups-invite__field">
                            <span>Default user role</span>
                            <select
                                value={defaultRole}
                                onChange={(e) => setDefaultRole(e.target.value as GroupInviteRole)}
                            >
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                                <option value="admin">Admin</option>
                            </select>
                        </label>

                        {createError && (
                            <p className="groups-invite__error" role="alert">
                                {createError}
                            </p>
                        )}

                        <div className="groups-modal__actions">
                            <button className="btn btn--outline" type="button" onClick={closeCreate}>
                                Cancel
                            </button>
                            <button className="btn btn--solid" type="submit">
                                Create group
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
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
    const [layoutSwitchTarget, setLayoutSwitchTarget] = useState<LayoutMode | null>(null)
    const [groups, setGroups] = useState<Group[]>(() => loadGroups())
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
    const [groupCreateOpen, setGroupCreateOpen] = useState(false)
    const [groupInviteOpen, setGroupInviteOpen] = useState(false)
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const normalizedQuery = query.trim().toLowerCase()
    const previousSearchQueryRef = useRef(normalizedQuery)
    const [animatedFiles, setAnimatedFiles] = useState<{ ids: string[]; exitingIds: Set<string> }>({
        ids: [],
        exitingIds: new Set(),
    })
    const menuRef = useRef<HTMLDivElement>(null)
    const layoutSwitchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
        const timeout = setTimeout(() => void refreshQuota(), 0)
        return () => clearTimeout(timeout)
    }, [])

    useEffect(() => {
        return () => {
            if (layoutSwitchTimeoutRef.current) clearTimeout(layoutSwitchTimeoutRef.current)
        }
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
        let pullFrame: number | undefined
        const frame = requestAnimationFrame(() => {
            setNavIndicatorPulling(false)
            pullFrame = requestAnimationFrame(() => setNavIndicatorPulling(true))
        })
        const timeout = window.setTimeout(() => setNavIndicatorPulling(false), 540)

        return () => {
            cancelAnimationFrame(frame)
            if (pullFrame) cancelAnimationFrame(pullFrame)
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
                if (view === 'groups') return []
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
        if (mode === layoutMode) return
        if (layoutSwitchTimeoutRef.current) clearTimeout(layoutSwitchTimeoutRef.current)

        setLayoutSwitchTarget(mode)
        setLayoutMode(mode)
        saveLayoutMode(mode)

        layoutSwitchTimeoutRef.current = setTimeout(() => {
            setLayoutSwitchTarget(null)
            layoutSwitchTimeoutRef.current = null
        }, LAYOUT_SWITCH_MS)
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

    function createGroup(name: string, defaultRole: GroupInviteRole) {
        setGroups((prev) => {
            const group: Group = {
                id: crypto.randomUUID(),
                name,
                defaultRole,
                createdAt: new Date().toISOString(),
                invites: [],
            }
            const next = [group, ...prev]
            saveGroups(next)
            setActiveGroupId(group.id)
            return next
        })
    }

    function openGroup(id: string) {
        setActiveGroupId(id)
        setGroupCreateOpen(false)
        setGroupInviteOpen(false)
    }

    function backToGroups() {
        setActiveGroupId(null)
        setGroupCreateOpen(false)
        setGroupInviteOpen(false)
    }

    function addGroupInvite(groupId: string, email: string, role: GroupInviteRole) {
        setGroups((prev) => {
            const next = prev.map((group) =>
                group.id === groupId
                    ? {
                          ...group,
                          invites: [
                              {
                                  id: crypto.randomUUID(),
                                  email,
                                  role,
                                  createdAt: new Date().toISOString(),
                              },
                              ...group.invites,
                          ],
                      }
                    : group,
            )
            saveGroups(next)
            return next
        })
    }

    function updateGroup(groupId: string, name: string, defaultRole: GroupInviteRole) {
        setGroups((prev) => {
            const next = prev.map((group) =>
                group.id === groupId
                    ? {
                          ...group,
                          name,
                          defaultRole,
                      }
                    : group,
            )
            saveGroups(next)
            return next
        })
    }

    function deleteGroup(groupId: string) {
        setGroups((prev) => {
            const next = prev.filter((group) => group.id !== groupId)
            saveGroups(next)
            return next
        })
        setActiveGroupId(null)
        setGroupCreateOpen(false)
        setGroupInviteOpen(false)
    }

    function removeGroupInvite(groupId: string, inviteId: string) {
        setGroups((prev) => {
            const next = prev.map((group) =>
                group.id === groupId
                    ? {
                          ...group,
                          invites: group.invites.filter((invite) => invite.id !== inviteId),
                      }
                    : group,
            )
            saveGroups(next)
            return next
        })
    }

    const visibleItems = useMemo(
        () =>
            items
                .filter((i) => i.filename.toLowerCase().includes(normalizedQuery))
                .filter((i) => (view === 'favourites' ? favouriteIds.has(i.id) : true)),
        [favouriteIds, items, normalizedQuery, view],
    )
    const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

    useEffect(() => {
        const nextIds = visibleItems.map((item) => item.id)
        const queryChanged = previousSearchQueryRef.current !== normalizedQuery
        previousSearchQueryRef.current = normalizedQuery

        if (!queryChanged) {
            setAnimatedFiles({ ids: nextIds, exitingIds: new Set() })
            return
        }

        let timeout: ReturnType<typeof setTimeout> | undefined
        setAnimatedFiles((prev) => {
            const nextIdSet = new Set(nextIds)
            const currentItemIds = new Set(items.map((item) => item.id))
            const exitingIds = prev.ids.filter((id) => !nextIdSet.has(id) && currentItemIds.has(id))

            if (exitingIds.length === 0) {
                return { ids: nextIds, exitingIds: new Set() }
            }

            timeout = setTimeout(() => {
                setAnimatedFiles({ ids: nextIds, exitingIds: new Set() })
            }, SEARCH_FILTER_EXIT_MS)

            return {
                ids: [
                    ...prev.ids.filter((id) => nextIdSet.has(id) || exitingIds.includes(id)),
                    ...nextIds.filter((id) => !prev.ids.includes(id)),
                ],
                exitingIds: new Set(exitingIds),
            }
        })

        return () => {
            if (timeout) clearTimeout(timeout)
        }
    }, [items, normalizedQuery, visibleItems])

    const renderedItems = animatedFiles.ids
        .map((id) => itemById.get(id))
        .filter((item): item is Item => Boolean(item))

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
                                {view === 'groups' && 'Groups'}
                                {view === 'trash' && 'Trash'}
                            </h1>
                        </div>

                        <div className="shell__content-actions">
                            <div
                                className={`view-toggle view-toggle--${layoutMode} ${
                                    layoutSwitchTarget ? 'is-switching' : ''
                                }`}
                                role="group"
                                aria-label="File layout"
                            >
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

                    {!loading && view === 'shared' && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title="Nothing shared yet"
                            body="Files someone shares with you will show up here, still encrypted end-to-end."
                        />
                    )}

                    {!loading && view === 'groups' && (
                        <GroupsPanel
                            groups={groups}
                            activeGroupId={activeGroupId}
                            createOpen={groupCreateOpen}
                            inviteOpen={groupInviteOpen}
                            onCreateGroup={createGroup}
                            onOpenCreate={() => {
                                setGroupCreateOpen(true)
                                setGroupInviteOpen(false)
                            }}
                            onCloseCreate={() => setGroupCreateOpen(false)}
                            onOpenGroup={openGroup}
                            onBackToGroups={backToGroups}
                            onOpenInvite={() => {
                                setGroupInviteOpen(true)
                                setGroupCreateOpen(false)
                            }}
                            onCloseInvite={() => setGroupInviteOpen(false)}
                            onInvite={addGroupInvite}
                            onRemoveInvite={removeGroupInvite}
                            onUpdateGroup={updateGroup}
                            onDeleteGroup={deleteGroup}
                        />
                    )}

                    {!loading && view === 'favourites' && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title={query ? 'No favourites match your search' : 'No favourites yet'}
                            body="Tap the star on any file to pin it here for quick access."
                        />
                    )}

                    {!loading && view === 'trash' && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title="Trash is empty"
                            body="Deleted files stay here for 30 days before they're gone for good."
                        />
                    )}

                    {!loading && view === 'all' && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title={query ? 'No files match your search' : 'Drop files to encrypt and sync'}
                            body={
                                query
                                    ? 'Try a different name, or clear the search to see everything.'
                                    : 'Files are locked with AES-256 on this device before they ever reach the network.'
                            }
                        />
                    )}

                    {!loading && renderedItems.length > 0 && (
                        <div
                            className={`file-grid file-grid--${layoutMode} ${
                                layoutSwitchTarget ? `is-layout-switching is-switching-to-${layoutSwitchTarget}` : ''
                            }`}
                        >
                            {renderedItems.map((item, i) => {
                                const isSearchExiting = animatedFiles.exitingIds.has(item.id)

                                return (
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
                                    draggable={!pendingIds.has(item.id) && !isSearchExiting}
                                    isDragging={draggedCardId === item.id}
                                    isDropTarget={dropTargetId === item.id}
                                    isSearchExiting={isSearchExiting}
                                    style={{ '--file-index': i } as React.CSSProperties}
                                    onDragStartCard={handleCardDragStart}
                                    onDragEnterCard={handleCardDragEnter}
                                    onDragLeaveCard={handleCardDragLeave}
                                    onDropCard={handleCardDrop}
                                    onDragEndCard={handleCardDragEnd}
                                />
                                )
                            })}
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
