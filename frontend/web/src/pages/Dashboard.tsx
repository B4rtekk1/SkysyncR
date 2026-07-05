import React, { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Dashbord.css'
import {
    listFiles,
    listTrash,
    listSharedFilesWithMe,
    getStorageQuota,
    softDeleteFile,
    restoreFile,
    uploadFile,
    type ApiFile,
    type SharedFile,
    type StorageQuota,
} from '../api/files'
import { logout } from '../api/auth'
import { generateFileKey, encryptFile, exportRawKey } from '../crypto/fileEncryption'

type ViewKey = 'all' | 'shared' | 'trash'
type Item = ApiFile | SharedFile

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

type FileKind = 'sheet' | 'doc' | 'archive' | 'video' | 'text' | 'image'

function kindFromFile(filename: string, mime: string | null): FileKind {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (mime?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext))
        return 'image'
    if (mime?.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi'].includes(ext)) return 'video'
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
    if (['txt', 'md'].includes(ext)) return 'text'
    return 'doc'
}

const KIND_ACCENT: Record<FileKind, string> = {
    sheet: 'var(--signal)',
    doc: 'var(--mist)',
    archive: 'var(--amber)',
    video: 'var(--amber)',
    text: 'var(--mist)',
    image: 'var(--signal)',
}

function FileIcon({ kind }: { kind: FileKind }) {
    const accent = KIND_ACCENT[kind]
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
}

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

function isShared(item: Item): item is SharedFile {
    return 'permission' in item
}

function FileCard({
                      item,
                      index,
                      pending,
                      onDelete,
                      onRestore,
                      view,
                  }: {
    item: Item
    index: number
    pending: boolean
    onDelete?: (id: string) => void
    onRestore?: (id: string) => void
    view: ViewKey
}) {
    const display = useDecryptReveal(item.filename, index * 60)
    const kind = kindFromFile(item.filename, item.mime_type)

    return (
        <article className="file-card">
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
                {formatBytes(item.size_bytes)} · {formatRelative(item.updated_at)}
                {isShared(item) && item.shared_by_user_name ? ` · shared by ${item.shared_by_user_name}` : ''}
            </p>
            {view === 'all' && onDelete && (
                <button className="file-card__action" onClick={() => onDelete(item.id)}>
                    Move to trash
                </button>
            )}
            {view === 'trash' && onRestore && (
                <button className="file-card__action" onClick={() => onRestore(item.id)}>
                    Restore
                </button>
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
    const [query, setQuery] = useState('')
    const [menuOpen, setMenuOpen] = useState(false)
    const [dragActive, setDragActive] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // TODO: replace with a real "current user" fetch once api/users.ts exposes one.
    const displayName = useMemo(() => {
        return localStorage.getItem('display_name') || sessionStorage.getItem('display_name') || 'You'
    }, [])

    const refreshQuota = async () => {
        try {
            const data = await getStorageQuota()
            setQuota(data)
        } catch {
            setQuota(null)
        }
    }

    useEffect(() => {
        void refreshQuota()
    }, [])

    useEffect(() => {
        let active = true

        Promise.resolve()
            .then(() => {
                if (!active) return undefined
                setLoading(true)
                setError(null)
                return view === 'all' ? listFiles() : view === 'trash' ? listTrash() : listSharedFilesWithMe()
            })
            .then((data) => {
                if (active && data) setItems(data)
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
                const key = await generateFileKey()
                const { ciphertext, nonce } = await encryptFile(file, key)
                const rawKey = await exportRawKey(key)
                // NOTE: rawKey should be wrapped with the user's RSA public key
                // (crypto/keys.ts) before this point in production — sending the
                // unwrapped key is a placeholder until that helper is confirmed.
                const encryptedBlob = new File([ciphertext], file.name, { type: 'application/octet-stream' })

                const saved = await uploadFile({
                    file: encryptedBlob,
                    encryptedKey: rawKey,
                    encryptionNonce: nonce.buffer as ArrayBuffer,
                })

                setItems((prev) => prev.map((i) => (i.id === tempId ? saved : i)))
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

    async function signOut() {
        await logout()
        window.location.href = '/login'
    }

    const visibleItems = items.filter((i) =>
        i.filename.toLowerCase().includes(query.trim().toLowerCase()),
    )

    const usedPct = quota ? Math.min(100, Math.round((quota.used_bytes / quota.total_bytes) * 100)) : 0

    return (
        <div className="shell">
            <aside className="shell__sidebar">
                <Link to="/" className="shell__logo">
                    <span className="nav__logo-mark" aria-hidden="true" />
                    SkysyncR
                </Link>

                <nav className="shell__navlist">
                    {(
                        [
                            ['all', 'All files'],
                            ['shared', 'Shared with me'],
                            ['trash', 'Trash'],
                        ] as [ViewKey, string][]
                    ).map(([key, label]) => (
                        <button
                            key={key}
                            className={`shell__navitem ${view === key ? 'is-active' : ''}`}
                            onClick={() => setView(key)}
                        >
                            <span className="shell__navicon">{NAV_ICONS[key]}</span>
                            {label}
                        </button>
                    ))}
                </nav>

                <nav className="shell__navlist shell__navlist--footer">
                    <Link to="/settings" className="shell__navitem">
                        <span className="shell__navicon">{SETTINGS_ICON}</span>
                        Settings
                    </Link>
                </nav>

                <div className="shell__storage">
                    <div className="shell__storage-row">
                        <span>Storage</span>
                        <span>
              {quota ? `${formatBytes(quota.used_bytes)} / ${formatBytes(quota.total_bytes)}` : '—'}
            </span>
                    </div>
                    <div className="shell__storage-bar">
                        <div className="shell__storage-fill" style={{ width: `${usedPct}%` }} />
                    </div>
                </div>
            </aside>

            <div className="shell__main">
                <header className="shell__topbar">
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
                        e.preventDefault()
                        setDragActive(true)
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onDrop}
                >
                    <div className="shell__content-head">
                        <div>
                            <p className="eyebrow">
                                <span className="eyebrow__dot" /> vault unlocked
                            </p>
                            <h1 className="shell__title">
                                {view === 'all' && 'All files'}
                                {view === 'shared' && 'Shared with me'}
                                {view === 'trash' && 'Trash'}
                            </h1>
                        </div>

                        {view === 'all' && (
                            <label className="btn btn--solid">
                                Upload
                                <input type="file" multiple onChange={onUploadChange} style={{ display: 'none' }} />
                            </label>
                        )}
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
                        <div className="file-grid">
                            {visibleItems.map((item, i) => (
                                <FileCard
                                    key={item.id}
                                    item={item}
                                    index={i}
                                    pending={pendingIds.has(item.id)}
                                    view={view}
                                    onDelete={view === 'all' ? handleDelete : undefined}
                                    onRestore={view === 'trash' ? handleRestore : undefined}
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