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
    type StorageQuota,
} from '../api/files'
import { logout } from '../api/auth'
import { getCurrentUser } from '../api/users'
import {
    decryptFile,
    generateFileKey,
    encryptFile,
    unwrapFileKeyForUser,
    wrapFileKeyForUser,
} from '../crypto/fileEncryption'
import { loadActivePrivateKey } from '../crypto/storage'
import { EmptyPane } from './dashboard/EmptyPane'
import { FileCard } from './dashboard/FileCard'
import { GroupsPanel } from './dashboard/GroupsPanel'
import { ImagePreviewModal } from './dashboard/ImagePreviewModal'
import {
    DRAG_HANDLE_ICON,
    GRID_VIEW_ICON,
    LIST_VIEW_ICON,
    NAV_ICONS,
    SETTINGS_ICON,
    SIDEBAR_HIDE_ICON,
    SIDEBAR_SHOW_ICON,
} from './dashboard/icons'
import {
    KIND_ACCENT,
    KIND_LABELS,
    formatBytes,
    kindFromFile,
    type FileKind,
} from './dashboard/fileUtils'
import {
    COMPACT_SIDEBAR_WIDTH,
    LAYOUT_SWITCH_MS,
    NAV_LABELS,
    SEARCH_FILTER_EXIT_MS,
    SIDEBAR_HIDDEN_STORAGE_KEY,
    SIDEBAR_WIDTH_STORAGE_KEY,
    applyLocalFileMetadata,
    applySavedOrder,
    clampSidebarWidth,
    loadActiveView,
    loadFavouriteIds,
    loadGroups,
    loadLayoutMode,
    loadNavOrder,
    loadSidebarHidden,
    loadSidebarWidth,
    saveActiveView,
    saveFavouriteIds,
    saveGroups,
    saveLayoutMode,
    saveLocalFileMetadata,
    saveNavOrder,
    saveOrderIds,
} from './dashboard/storage'
import type { Group, GroupInviteRole, ImagePreviewState, Item, LayoutMode, NavIndicator, ViewKey } from './dashboard/types'
function Dashboard() {
    const [view, setView] = useState<ViewKey>(() => loadActiveView())
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
    const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null)
    const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)
    const normalizedQuery = query.trim().toLowerCase()
    const previousSearchQueryRef = useRef(normalizedQuery)
    const [animatedFiles, setAnimatedFiles] = useState<{ ids: string[]; exitingIds: Set<string> }>({
        ids: [],
        exitingIds: new Set(),
    })
    const menuRef = useRef<HTMLDivElement>(null)
    const layoutSwitchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const imagePreviewUrlRef = useRef<string | null>(null)
    const imagePreviewRequestRef = useRef(0)
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
            if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
        }
    }, [])

    useEffect(() => {
        if (!imagePreview) return

        function onKeyDown(e: globalThis.KeyboardEvent) {
            if (e.key === 'Escape') closeImagePreview()
        }

        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [imagePreview])

    useEffect(() => {
        let active = true
        getCurrentUser()
            .then((user) => {
                if (!active) return
                setPublicKey(user.public_key)
                return loadActivePrivateKey(user.id)
            })
            .then((key) => {
                if (active) setPrivateKey(key ?? null)
            })
            .catch(() => {
                if (active) {
                    setPublicKey(null)
                    setPrivateKey(null)
                }
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
        saveActiveView(view)
    }, [view])

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
                encrypted_key: '',
                encryption_nonce: '',
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
            const blob = await decryptDownloadedFile(item)
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

    async function decryptDownloadedFile(item: Item): Promise<Blob> {
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to unlock your vault.')
        }
        if (!item.encrypted_key || !item.encryption_nonce) {
            throw new Error('File encryption metadata is missing.')
        }

        const encryptedBlob = await downloadFile(item.id)
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        return decryptFile(encryptedBlob, fileKey, item.encryption_nonce, item.mime_type)
    }

    function clearImagePreviewUrl() {
        if (imagePreviewUrlRef.current) {
            URL.revokeObjectURL(imagePreviewUrlRef.current)
            imagePreviewUrlRef.current = null
        }
    }

    function closeImagePreview() {
        imagePreviewRequestRef.current += 1
        clearImagePreviewUrl()
        setImagePreview(null)
    }

    async function handleImagePreview(item: Item) {
        if (kindFromFile(item.filename, item.mime_type) !== 'image') return

        const requestId = imagePreviewRequestRef.current + 1
        imagePreviewRequestRef.current = requestId
        clearImagePreviewUrl()
        setError(null)
        setImagePreview({ item, url: null, loading: true })

        try {
            const previewBlob = await decryptDownloadedFile(item)
            const url = URL.createObjectURL(previewBlob)

            if (imagePreviewRequestRef.current !== requestId) {
                URL.revokeObjectURL(url)
                return
            }

            imagePreviewUrlRef.current = url
            setImagePreview({ item, url, loading: false })
        } catch (e) {
            if (imagePreviewRequestRef.current === requestId) {
                setImagePreview(null)
                setError(e instanceof Error ? e.message : 'Could not preview that image.')
            }
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
                                    onPreview={view !== 'trash' ? handleImagePreview : undefined}
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
            {imagePreview && (
                <ImagePreviewModal
                    preview={imagePreview}
                    onClose={closeImagePreview}
                    onDownload={handleDownload}
                />
            )}
        </div>
    )
}

export default Dashboard

