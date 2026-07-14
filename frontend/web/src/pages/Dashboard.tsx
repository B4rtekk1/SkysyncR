import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../App.css'
import '../css/Dashbord.css'
import ThemeToggle from '../components/ThemeToggle'
import SettingsModal from './Settings'
import {
    listFiles,
    listFolders,
    createFolder,
    listTrash,
    listSharedFilesWithMe,
    getStorageQuota,
    renameFile,
    shareFolder,
    updateFileNote,
    type ApiFile,
    type ApiFolder,
    type StorageQuota,
} from '../api/files'
import { logout } from '../api/auth'
import { getUnlockedVaultSession } from '../api/session'
import { encryptTextEnvelope, isEncryptedTextEnvelope, unwrapFileKeyForUser } from '../crypto/fileEncryption'
import { EmptyPane } from './dashboard/EmptyPane'
import { FileCard } from './dashboard/FileCard'
import { FileFilterModal } from './dashboard/FileFilterModal'
import { FolderCard } from './dashboard/FolderCard'
import { FileNoteModal } from './dashboard/FileNoteModal'
import { GroupsPanel } from './dashboard/GroupsPanel'
import { ImagePreviewModal } from './dashboard/ImagePreviewModal'
import { ShareFileModal } from './dashboard/ShareFileModal'
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
} from './dashboard/fileUtils'
import {
    FILE_SORT_LABELS,
    formatSizeValue,
    getFilterSummary,
    hasActiveFileFilters,
    matchesFileFilters,
    parseSizeInputToMb,
    parseSizeMb,
    sortFiles,
} from './dashboard/fileFilters'
import {
    NAV_LABELS,
    applyLocalFileMetadata,
    applySavedOrder,
    loadActiveView,
    loadFileFilter,
    loadFileSort,
    loadFavouriteIds,
    saveActiveView,
    saveFileFilter,
    saveFileSort,
    saveOrderIds,
} from './dashboard/storage'
import { useAnimatedItems } from './dashboard/hooks/useAnimatedItems'
import { useFileActions } from './dashboard/hooks/useFileActions'
import { useDashboardGroups } from './dashboard/hooks/useDashboardGroups'
import { useFilePreview } from './dashboard/hooks/useFilePreview'
import { useFileUpload } from './dashboard/hooks/useFileUpload'
import { useLayoutModeSwitch } from './dashboard/hooks/useLayoutModeSwitch'
import { useNavOrdering } from './dashboard/hooks/useNavOrdering'
import { useSidebarState } from './dashboard/hooks/useSidebarState'
import { useStorageSummary } from './dashboard/hooks/useStorageSummary'
import { decryptFilesMetadata } from './dashboard/encryptedMetadata'
import type { FileFilters, FileSortKey, FileTypeFilterKey, FileVisibilityFilterKey, Item, NavIndicator, ShareableItem, ViewKey } from './dashboard/types'

async function migratePlaintextFileMetadata(files: ApiFile[], privateKey: CryptoKey) {
    await Promise.allSettled(
        files.map(async (file) => {
            const shouldEncryptFilename = !isEncryptedTextEnvelope(file.filename)
            const shouldEncryptNote = Boolean(file.note) && !isEncryptedTextEnvelope(file.note)
            if (!shouldEncryptFilename && !shouldEncryptNote) return

            const fileKey = await unwrapFileKeyForUser(file.encrypted_key, privateKey)
            await Promise.all([
                shouldEncryptFilename
                    ? renameFile(file.id, await encryptTextEnvelope(file.filename, fileKey))
                    : Promise.resolve(),
                shouldEncryptNote && file.note
                    ? updateFileNote(file.id, await encryptTextEnvelope(file.note, fileKey))
                    : Promise.resolve(),
            ])
        }),
    )
}

function Dashboard() {
    const navigate = useNavigate()
    const [view, setView] = useState<ViewKey>(() => loadActiveView())
    const [items, setItems] = useState<Item[]>([])
    const [folders, setFolders] = useState<ApiFolder[]>([])
    const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
    const [folderTrail, setFolderTrail] = useState<ApiFolder[]>([])
    const [sortKey, setSortKey] = useState<FileSortKey>(() => loadFileSort())
    const [fileFilters, setFileFilters] = useState<FileFilters>(() => loadFileFilter())
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [quota, setQuota] = useState<StorageQuota | null>(null)
    const [storageItems, setStorageItems] = useState<ApiFile[]>([])
    const [query, setQuery] = useState('')
    const [menuOpen, setMenuOpen] = useState(false)
    const [sortMenuOpen, setSortMenuOpen] = useState(false)
    const [sortMenuClosing, setSortMenuClosing] = useState(false)
    const [filterMenuOpen, setFilterMenuOpen] = useState(false)
    const [filterMenuClosing, setFilterMenuClosing] = useState(false)
    const [dragActive, setDragActive] = useState(false)
    const [favouriteIds, setFavouriteIds] = useState<Set<string>>(() => loadFavouriteIds())
    const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [noteItem, setNoteItem] = useState<Item | null>(null)
    const [noteSaving, setNoteSaving] = useState(false)
    const [folderCreateOpen, setFolderCreateOpen] = useState(false)
    const [folderNameDraft, setFolderNameDraft] = useState('')
    const [folderSaving, setFolderSaving] = useState(false)
    const [shareItem, setShareItem] = useState<ShareableItem | null>(null)
    const [shareLoading, setShareLoading] = useState(false)
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null)
    const normalizedQuery = query.trim().toLowerCase()
    const hasActiveFilter = hasActiveFileFilters(fileFilters)
    const filterSummary = getFilterSummary(fileFilters)
    const menuRef = useRef<HTMLDivElement>(null)
    const sortMenuRef = useRef<HTMLDivElement>(null)
    const sortMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const filterMenuRef = useRef<HTMLDivElement>(null)
    const filterMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const {
        navOrder,
        draggedNavKey,
        dropNavTarget,
        handleNavDragStart,
        handleNavDragEnter,
        handleNavDragLeave,
        handleNavDrop,
        handleNavDragEnd,
    } = useNavOrdering()
    const {
        sidebarWidth,
        sidebarHidden,
        sidebarCompact,
        setSidebarHidden,
        startSidebarResize,
    } = useSidebarState()
    const { layoutMode, layoutSwitchTarget, changeLayoutMode } = useLayoutModeSwitch()
    const {
        groups,
        activeGroupId,
        groupCreateOpen,
        groupInviteOpen,
        setGroupCreateOpen,
        setGroupInviteOpen,
        createGroup,
        openGroup,
        backToGroups,
        addGroupInvite,
        updateGroup,
        deleteGroup,
        removeGroupInvite,
    } = useDashboardGroups()
    function handleFileUpdated(updated: ApiFile) {
        const previousSize = storageItems.find((item) => item.id === updated.id)?.size_bytes ?? updated.size_bytes
        const sizeDelta = updated.size_bytes - previousSize

        setStorageItems((prev) =>
            prev.map((current) => {
                if (current.id !== updated.id) return current

                return { ...updated, filename: current.filename, mime_type: current.mime_type, note: current.note }
            }),
        )
        setItems((prev) =>
            prev.map((current) =>
                current.id === updated.id
                    ? { ...updated, filename: current.filename, mime_type: current.mime_type, note: current.note }
                    : current,
            ),
        )
        setQuota((current) =>
            current && sizeDelta !== 0 ? { ...current, used_bytes: current.used_bytes + sizeDelta } : current,
        )
    }

    const { filePreview, closeFilePreview, handleDownload, handleFilePreview, handleSaveTextFile } = useFilePreview(
        privateKey,
        publicKey,
        setError,
        handleFileUpdated,
    )
    const filteredItems = useMemo(
        () => items.filter((item) => matchesFileFilters(item, fileFilters)),
        [fileFilters, items],
    )
    const visibleFolders = useMemo(() => {
        if (view !== 'all') return []
        return folders.filter((folder) => folder.name.toLowerCase().includes(normalizedQuery))
    }, [folders, normalizedQuery, view])
    const sortedItems = useMemo(() => sortFiles(filteredItems, sortKey), [filteredItems, sortKey])
    const { visibleItems, renderedItems, animatedFiles } = useAnimatedItems({
        items: sortedItems,
        view,
        favouriteIds,
        normalizedQuery,
    })
    const {
        usedPct,
        storageStatus,
        storageStatusText,
        storageBreakdown,
        storageBreakdownTotal,
    } = useStorageSummary(quota, storageItems)
    const sizeSliderMax = useMemo(() => {
        const largestItemKb = Math.ceil(Math.max(0, ...items.map((item) => item.size_bytes)) / 1024)
        const configuredMaxKb = (parseSizeMb(fileFilters.maxSizeMb) ?? 0) * 1024
        return Math.max(1, largestItemKb, Math.ceil(configuredMaxKb))
    }, [fileFilters.maxSizeMb, items])
    const sizeSliderMinValue = Math.min((parseSizeMb(fileFilters.minSizeMb) ?? 0) * 1024, sizeSliderMax)
    const sizeSliderMaxValue = Math.min(
        (parseSizeMb(fileFilters.maxSizeMb) ?? sizeSliderMax / 1024) * 1024,
        sizeSliderMax,
    )
    const sizeSliderMinPct = (sizeSliderMinValue / sizeSliderMax) * 100
    const sizeSliderMaxPct = (sizeSliderMaxValue / sizeSliderMax) * 100

    // TODO: replace with a real "current user" fetch once api/users.ts exposes one.
    const displayName = useMemo(() => {
        return localStorage.getItem('display_name') || sessionStorage.getItem('display_name') || 'You'
    }, [])

    const refreshQuota = useCallback(async () => {
        try {
            const [quotaData, fileData] = await Promise.all([getStorageQuota(), listFiles()])
            const visibleFileData = privateKey ? await decryptFilesMetadata(fileData, privateKey) : fileData
            if (privateKey) void migratePlaintextFileMetadata(fileData, privateKey)
            setQuota(quotaData)
            setStorageItems(applyLocalFileMetadata(visibleFileData))
        } catch {
            setQuota(null)
        }
    }, [privateKey])

    const { ingestFiles } = useFileUpload({
        publicKey,
        folderId: view === 'all' ? activeFolderId : null,
        setItems,
        setPendingIds,
        setError,
        refreshQuota,
    })
    const {
        handleDelete,
        handleRestore,
        handleRename,
        handleShare,
        setFileSharing,
        toggleFavourite,
    } = useFileActions({
        setItems,
        setStorageItems,
        setError,
        setShareItem,
        setShareLoading,
        setFavouriteIds,
        refreshQuota,
        privateKey,
    })

    useEffect(() => {
        const timeout = setTimeout(() => void refreshQuota(), 0)
        return () => clearTimeout(timeout)
    }, [refreshQuota])

    useEffect(() => {
        let active = true
        getUnlockedVaultSession()
            .then((session) => {
                if (!active) return
                if (!session) {
                    navigate('/login', { replace: true })
                    return
                }

                setPublicKey(session.user.public_key)
                setPrivateKey(session.privateKey)
            })
            .catch(() => {
                if (active) {
                    setPublicKey(null)
                    setPrivateKey(null)
                    navigate('/login', { replace: true })
                }
            })

        return () => {
            active = false
        }
    }, [navigate])

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
        saveActiveView(view)
    }, [view])

    useEffect(() => {
        saveFileSort(sortKey)
    }, [sortKey])

    useEffect(() => {
        saveFileFilter(fileFilters)
    }, [fileFilters])

    useEffect(() => {
        let active = true

        async function loadDashboardData() {
            if (!active) return

            try {
                setLoading(true)
                setError(null)
                if (view === 'groups') {
                    setFolders([])
                    setItems([])
                    return
                }

                if (!privateKey) return

                let fileData: ApiFile[]
                let folderData: ApiFolder[] = []

                if (view === 'all') {
                    const [files, foldersData] = await Promise.all([
                        listFiles(activeFolderId ?? undefined),
                        listFolders(activeFolderId ?? undefined),
                    ])
                    fileData = files
                    folderData = foldersData
                } else if (view === 'favourites') {
                    fileData = await listFiles()
                    setFolders([])
                } else if (view === 'trash') {
                    fileData = await listTrash()
                    setFolders([])
                } else {
                    fileData = await listSharedFilesWithMe()
                    setFolders([])
                }

                if (active) {
                    const visibleFileData = await decryptFilesMetadata(fileData, privateKey)
                    if (view !== 'shared') void migratePlaintextFileMetadata(fileData, privateKey)
                    const withLocalMetadata = applyLocalFileMetadata(visibleFileData)
                    setItems(applySavedOrder(withLocalMetadata, view))
                    setFolders(folderData)
                    if (view === 'all' || view === 'favourites') {
                        setStorageItems(withLocalMetadata as ApiFile[])
                    }
                }
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load your files.')
            } finally {
                if (active) setLoading(false)
            }
        }

        void loadDashboardData()

        return () => {
            active = false
        }
    }, [activeFolderId, privateKey, view])

    const closeSortMenu = useCallback(() => {
        if (!sortMenuOpen || sortMenuClosing) return
        setSortMenuClosing(true)
        sortMenuCloseTimerRef.current = setTimeout(() => {
            setSortMenuOpen(false)
            setSortMenuClosing(false)
            sortMenuCloseTimerRef.current = null
        }, 180)
    }, [sortMenuClosing, sortMenuOpen])

    const closeFilterMenu = useCallback(() => {
        if (!filterMenuOpen || filterMenuClosing) return
        setFilterMenuClosing(true)
        filterMenuCloseTimerRef.current = setTimeout(() => {
            setFilterMenuOpen(false)
            setFilterMenuClosing(false)
            filterMenuCloseTimerRef.current = null
        }, 180)
    }, [filterMenuClosing, filterMenuOpen])

    useEffect(() => {
        function onClickAway(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
            if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
                closeSortMenu()
            }
            if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
                closeFilterMenu()
            }
        }
        document.addEventListener('mousedown', onClickAway)
        return () => document.removeEventListener('mousedown', onClickAway)
    }, [closeFilterMenu, closeSortMenu])

    useEffect(() => {
        return () => {
            if (sortMenuCloseTimerRef.current) {
                clearTimeout(sortMenuCloseTimerRef.current)
            }
            if (filterMenuCloseTimerRef.current) {
                clearTimeout(filterMenuCloseTimerRef.current)
            }
        }
    }, [])

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

    async function handleSaveNote(item: Item, note: string) {
        setNoteSaving(true)
        setError(null)
        try {
            if (!privateKey) {
                throw new Error('Private key is locked. Sign in again to save encrypted notes.')
            }

            const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
            const encryptedNote = note.trim() ? await encryptTextEnvelope(note, fileKey) : ''
            const updated = await updateFileNote(item.id, encryptedNote)
            setItems((prev) =>
                prev.map((current) =>
                    current.id === item.id
                        ? { ...updated, filename: current.filename, mime_type: current.mime_type, note: note.trim() ? note : null }
                        : current,
                ),
            )
            setStorageItems((prev) =>
                prev.map((current) =>
                    current.id === item.id
                        ? { ...updated, filename: current.filename, mime_type: current.mime_type, note: note.trim() ? note : null }
                        : current,
                ),
            )
            setNoteItem(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Nie udalo sie zapisac notatki.')
            throw e
        } finally {
            setNoteSaving(false)
        }
    }

    function openFolder(folder: ApiFolder) {
        setActiveFolderId(folder.id)
        setFolderTrail((current) => [...current, folder])
        setQuery('')
    }

    function openFolderRoot() {
        setActiveFolderId(null)
        setFolderTrail([])
        setQuery('')
    }

    function selectNavView(key: ViewKey) {
        if (key === 'all') {
            openFolderRoot()
        }
        setView(key)
    }

    function openFolderParent() {
        setFolderTrail((current) => {
            const next = current.slice(0, -1)
            setActiveFolderId(next.at(-1)?.id ?? null)
            return next
        })
        setQuery('')
    }

    async function handleCreateFolder() {
        const name = folderNameDraft.trim()
        if (!name || folderSaving) return

        setFolderSaving(true)
        setError(null)
        try {
            const folder = await createFolder({
                name,
                parentFolderId: activeFolderId,
            })
            setFolders((current) => [...current, folder].sort((a, b) => a.name.localeCompare(b.name)))
            setFolderNameDraft('')
            setFolderCreateOpen(false)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Nie udalo sie utworzyc folderu.')
        } finally {
            setFolderSaving(false)
        }
    }

    function handleShareFolder(folder: ApiFolder) {
        setError(null)
        setShareItem(folder)
    }

    async function setFolderSharing(folder: ApiFolder, isPublic: boolean) {
        setShareLoading(true)
        setError(null)
        try {
            const shared = await shareFolder(folder.id, isPublic)
            setFolders((current) => current.map((item) => (item.id === folder.id ? shared : item)))
            setShareItem(shared)
            return shared
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update sharing for that folder.')
            throw e
        } finally {
            setShareLoading(false)
        }
    }

    function toggleFileTypeFilter(type: FileTypeFilterKey) {
        setFileFilters((current) => ({
            ...current,
            types: current.types.includes(type)
                ? current.types.filter((currentType) => currentType !== type)
                : [...current.types, type],
        }))
    }

    function updateVisibilityFilter(visibility: FileVisibilityFilterKey) {
        setFileFilters((current) => ({ ...current, visibility }))
    }

    function updateSizeFilter(field: 'minSizeMb' | 'maxSizeMb', value: string) {
        const nextSizeMb = parseSizeInputToMb(value)
        if (nextSizeMb === null) return
        setFileFilters((current) => ({ ...current, [field]: nextSizeMb }))
    }

    function updateSizeSlider(field: 'minSizeMb' | 'maxSizeMb', value: string) {
        const nextValueKb = Math.round(Number(value))
        if (!Number.isFinite(nextValueKb)) return

        setFileFilters((current) => {
            const currentMinKb = (parseSizeMb(current.minSizeMb) ?? 0) * 1024
            const currentMaxKb = (parseSizeMb(current.maxSizeMb) ?? sizeSliderMax / 1024) * 1024

            if (field === 'minSizeMb') {
                const nextMinKb = Math.min(nextValueKb, currentMaxKb)
                return { ...current, minSizeMb: nextMinKb > 0 ? formatSizeValue(nextMinKb / 1024) : '' }
            }

            const nextMaxKb = Math.max(nextValueKb, currentMinKb)
            return { ...current, maxSizeMb: nextMaxKb < sizeSliderMax ? formatSizeValue(nextMaxKb / 1024) : '' }
        })
    }

    function updateExcludedExtensions(value: string) {
        setFileFilters((current) => ({ ...current, excludedExtensions: value }))
    }

    function updateModifiedDateFilter(field: 'modifiedFrom' | 'modifiedTo', value: string) {
        setFileFilters((current) => ({ ...current, [field]: value }))
    }

    function clearFileFilters() {
        setFileFilters({
            types: [],
            visibility: 'any',
            minSizeMb: '',
            maxSizeMb: '',
            excludedExtensions: '',
            modifiedFrom: '',
            modifiedTo: '',
        })
    }

    function openSortMenu() {
        if (sortMenuCloseTimerRef.current) {
            clearTimeout(sortMenuCloseTimerRef.current)
            sortMenuCloseTimerRef.current = null
        }
        setSortMenuClosing(false)
        setSortMenuOpen(true)
    }

    function toggleSortMenu() {
        const toggleMenu = sortMenuOpen ? closeSortMenu : openSortMenu
        toggleMenu()
    }

    function openFilterMenu() {
        if (filterMenuCloseTimerRef.current) {
            clearTimeout(filterMenuCloseTimerRef.current)
            filterMenuCloseTimerRef.current = null
        }
        setFilterMenuClosing(false)
        setFilterMenuOpen(true)
    }

    function toggleFilterMenu() {
        const toggleMenu = filterMenuOpen ? closeFilterMenu : openFilterMenu
        toggleMenu()
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
        if (sortKey !== 'manual') return
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

    async function signOut() {
        await logout()
        window.location.href = '/login'
    }

    return (
        <div
            className={`shell ${sidebarHidden ? 'is-sidebar-hidden' : ''} ${sidebarCompact ? 'is-sidebar-compact' : ''}`}
            style={{ '--sidebar-width': sidebarHidden ? '0px' : `${sidebarWidth}px` } as React.CSSProperties}
        >
            <aside className="shell__sidebar" aria-hidden={sidebarHidden}>
                <Link to="/dashboard" className="shell__logo">
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
                            onClick={() => selectNavView(key)}
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
                    <button className="shell__navitem" type="button" onClick={() => setSettingsOpen(true)}>
                        <span className="shell__navicon">{SETTINGS_ICON}</span>
                        <span className="shell__sidebar-label">Settings</span>
                    </button>
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
                            {view !== 'groups' && (
                                <div className="sort-dropdown" ref={sortMenuRef}>
                                    <button
                                        className={`sort-dropdown__trigger ${sortMenuOpen ? 'is-open' : ''}`}
                                        type="button"
                                        onClick={toggleSortMenu}
                                        aria-haspopup="listbox"
                                        aria-expanded={sortMenuOpen}
                                        aria-label="Sort files"
                                        title="Sort files"
                                    >
                                        <span className="sort-dropdown__icon" aria-hidden="true">
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                                <path
                                                    d="M4 7h10M4 12h7M4 17h4M18 6v12m0 0 3-3m-3 3-3-3"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </span>
                                        <span className="sort-dropdown__text">
                                            <span className="sort-dropdown__label">Sort by</span>
                                            <span className="sort-dropdown__value">{FILE_SORT_LABELS[sortKey]}</span>
                                        </span>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path
                                                d="m7 10 5 5 5-5"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    </button>

                                    {sortMenuOpen && (
                                        <div
                                            className={`sort-dropdown__menu sort-dropdown__menu--animated ${
                                                sortMenuClosing ? 'is-closing' : 'is-opening'
                                            }`}
                                            role="listbox"
                                            aria-label="Sort files"
                                        >
                                            {Object.entries(FILE_SORT_LABELS).map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    className={`sort-dropdown__option ${
                                                        sortKey === value ? 'is-selected' : ''
                                                    }`}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={sortKey === value}
                                                    onClick={() => {
                                                        setSortKey(value as FileSortKey)
                                                        closeSortMenu()
                                                    }}
                                                >
                                                    <span>{label}</span>
                                                    {sortKey === value && (
                                                        <svg
                                                            width="15"
                                                            height="15"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            aria-hidden="true"
                                                        >
                                                            <path
                                                                d="M5 12.5 9.3 17 19 7"
                                                                stroke="currentColor"
                                                                strokeWidth="1.9"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                        </svg>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {view !== 'groups' && (
                                <div className="sort-dropdown file-filter" ref={filterMenuRef}>
                                    <button
                                        className={`sort-dropdown__trigger file-filter__trigger ${
                                            filterMenuOpen ? 'is-open' : ''
                                        } ${hasActiveFilter ? 'has-filter' : ''}`}
                                        type="button"
                                        onClick={toggleFilterMenu}
                                        aria-haspopup="dialog"
                                        aria-expanded={filterMenuOpen}
                                        aria-label="Filter files"
                                        title="Filter files"
                                    >
                                        <span className="sort-dropdown__icon" aria-hidden="true">
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                                <path
                                                    d="M4 6h16l-6.2 7.1V18l-3.6 1.8v-6.7L4 6Z"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </span>
                                        <span className="sort-dropdown__text">
                                            <span className="sort-dropdown__label">Filter</span>
                                            <span className="sort-dropdown__value">{filterSummary}</span>
                                        </span>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path
                                                d="m7 10 5 5 5-5"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    </button>

                                    <FileFilterModal
                                        isOpen={filterMenuOpen}
                                        isClosing={filterMenuClosing}
                                        filterSummary={filterSummary}
                                        query={query}
                                        fileFilters={fileFilters}
                                        hasActiveFilter={hasActiveFilter}
                                        sizeSliderMax={sizeSliderMax}
                                        sizeSliderMinValue={sizeSliderMinValue}
                                        sizeSliderMaxValue={sizeSliderMaxValue}
                                        sizeSliderMinPct={sizeSliderMinPct}
                                        sizeSliderMaxPct={sizeSliderMaxPct}
                                        onClose={closeFilterMenu}
                                        onQueryChange={setQuery}
                                        onClearFileTypes={() => setFileFilters((current) => ({ ...current, types: [] }))}
                                        onToggleFileType={toggleFileTypeFilter}
                                        onVisibilityChange={updateVisibilityFilter}
                                        onSizeInputChange={updateSizeFilter}
                                        onSizeSliderChange={updateSizeSlider}
                                        onExcludedExtensionsChange={updateExcludedExtensions}
                                        onModifiedDateChange={updateModifiedDateFilter}
                                        onClearFilters={clearFileFilters}
                                    />
                                </div>
                            )}

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
                                <>
                                    <button
                                        className="btn btn--ghost"
                                        type="button"
                                        onClick={() => setFolderCreateOpen(true)}
                                    >
                                        New folder
                                    </button>
                                    <label className="btn btn--solid">
                                        Upload
                                        <input type="file" multiple onChange={onUploadChange} style={{ display: 'none' }} />
                                    </label>
                                </>
                            )}
                        </div>
                    </div>

                    {view === 'all' && folderTrail.length > 0 && (
                        <div className="folder-path" aria-label="Current folder">
                            <button type="button" onClick={openFolderRoot}>All files</button>
                            {folderTrail.map((folder, index) => (
                                <span key={folder.id}>
                                    <span aria-hidden="true">/</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const nextTrail = folderTrail.slice(0, index + 1)
                                            setFolderTrail(nextTrail)
                                            setActiveFolderId(folder.id)
                                            setQuery('')
                                        }}
                                    >
                                        {folder.name}
                                    </button>
                                </span>
                            ))}
                            <button className="folder-path__up" type="button" onClick={openFolderParent}>
                                Up
                            </button>
                        </div>
                    )}

                    {error && (
                        <p className="shell__error" role="alert">
                            {error}
                        </p>
                    )}

                    {loading && <p className="shell__loading">Loading…</p>}

                    {!loading && view === 'shared' && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title={
                                query
                                    ? 'No shared files match your search'
                                    : hasActiveFilter
                                        ? 'No shared files match your filters'
                                        : 'Nothing shared yet'
                            }
                            body={
                                query || hasActiveFilter
                                    ? 'Adjust the search or filter to see more shared files.'
                                    : 'Files someone shares with you will show up here, still encrypted end-to-end.'
                            }
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
                            title={
                                query
                                    ? 'No favourites match your search'
                                    : hasActiveFilter
                                        ? 'No favourites match your filters'
                                        : 'No favourites yet'
                            }
                            body={
                                query || hasActiveFilter
                                    ? 'Adjust the search or filter to see more favourites.'
                                    : 'Tap the star on any file to pin it here for quick access.'
                            }
                        />
                    )}

                    {!loading && view === 'trash' && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title={hasActiveFilter || query ? 'No deleted files match' : 'Trash is empty'}
                            body={
                                hasActiveFilter || query
                                    ? 'Adjust the search or filter to see more deleted files.'
                                    : "Deleted files stay here for 30 days before they're gone for good."
                            }
                        />
                    )}

                    {!loading && view === 'all' && visibleFolders.length === 0 && visibleItems.length === 0 && renderedItems.length === 0 && (
                        <EmptyPane
                            title={
                                query
                                    ? 'No files match your search'
                                    : hasActiveFilter
                                        ? 'No files match your filters'
                                        : 'Drop files to encrypt and sync'
                            }
                            body={
                                query || hasActiveFilter
                                    ? 'Try a different name, or clear the filter to see everything.'
                                    : 'Files are locked with AES-256 on this device before they ever reach the network.'
                            }
                        />
                    )}

                    {!loading && (visibleFolders.length > 0 || renderedItems.length > 0) && (
                        <div
                            className={`file-grid file-grid--${layoutMode} ${
                                layoutSwitchTarget ? `is-layout-switching is-switching-to-${layoutSwitchTarget}` : ''
                            }`}
                        >
                            {visibleFolders.map((folder, i) => (
                                <FolderCard
                                    key={folder.id}
                                    folder={folder}
                                    index={i}
                                    onOpen={openFolder}
                                    onShare={handleShareFolder}
                                />
                            ))}
                            {renderedItems.map((item, i) => {
                                const isSearchExiting = animatedFiles.exitingIds.has(item.id)

                                return (
                                <FileCard
                                    key={item.id}
                                    item={item}
                                    index={visibleFolders.length + i}
                                    pending={pendingIds.has(item.id)}
                                    view={view}
                                    onDelete={view === 'all' ? handleDelete : undefined}
                                    onRestore={view === 'trash' ? handleRestore : undefined}
                                    onDownload={view !== 'trash' ? handleDownload : undefined}
                                    onPreview={view !== 'trash' ? handleFilePreview : undefined}
                                    onRename={
                                        view === 'all' || view === 'favourites' ? handleRename : undefined
                                    }
                                    onShare={
                                        view === 'all' || view === 'favourites' ? handleShare : undefined
                                    }
                                    onNote={
                                        view === 'all' || view === 'favourites' ? setNoteItem : undefined
                                    }
                                    isFavourite={favouriteIds.has(item.id)}
                                    onToggleFavourite={
                                        view === 'all' || view === 'favourites' ? toggleFavourite : undefined
                                    }
                                    draggable={sortKey === 'manual' && !pendingIds.has(item.id) && !isSearchExiting}
                                    isDragging={draggedCardId === item.id}
                                    isDropTarget={dropTargetId === item.id}
                                    isSearchExiting={isSearchExiting}
                                    style={{ '--file-index': visibleFolders.length + i } as React.CSSProperties}
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
            {filePreview && (
                <ImagePreviewModal
                    preview={filePreview}
                    onClose={closeFilePreview}
                    onDownload={handleDownload}
                    onSaveText={handleSaveTextFile}
                />
            )}
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            {folderCreateOpen && (
                <div className="file-filter__modal is-opening" role="dialog" aria-modal="true" aria-labelledby="folder-create-title">
                    <div className="file-filter__dialog folder-create">
                        <div className="file-filter__modal-head">
                            <div>
                                <h2 id="folder-create-title">New folder</h2>
                                <span>{folderTrail.at(-1)?.name ?? 'All files'}</span>
                            </div>
                            <button
                                className="file-filter__close"
                                type="button"
                                onClick={() => {
                                    setFolderCreateOpen(false)
                                    setFolderNameDraft('')
                                }}
                                aria-label="Close"
                            >
                                x
                            </button>
                        </div>
                        <div className="file-filter__modal-body">
                            <input
                                className="folder-create__input"
                                value={folderNameDraft}
                                onChange={(event) => setFolderNameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') void handleCreateFolder()
                                    if (event.key === 'Escape') setFolderCreateOpen(false)
                                }}
                                placeholder="Folder name"
                                autoFocus
                            />
                        </div>
                        <div className="file-filter__footer">
                            <button
                                className="btn btn--ghost"
                                type="button"
                                onClick={() => {
                                    setFolderCreateOpen(false)
                                    setFolderNameDraft('')
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn--solid"
                                type="button"
                                disabled={!folderNameDraft.trim() || folderSaving}
                                onClick={() => void handleCreateFolder()}
                            >
                                {folderSaving ? 'Creating...' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {noteItem && (
                <FileNoteModal
                    item={noteItem}
                    saving={noteSaving}
                    onClose={() => setNoteItem(null)}
                    onSave={handleSaveNote}
                />
            )}
            {shareItem && (
                <ShareFileModal
                    item={shareItem}
                    itemKind={'filename' in shareItem ? 'file' : 'folder'}
                    shareUrl={
                        shareItem.is_public && shareItem.share_token
                            ? `${window.location.origin}/share/${'filename' in shareItem ? '' : 'folders/'}${shareItem.share_token}`
                            : null
                    }
                    loading={shareLoading}
                    onClose={() => setShareItem(null)}
                    onEnableShare={async () => {
                        if ('filename' in shareItem) {
                            await setFileSharing(shareItem, true)
                        } else {
                            await setFolderSharing(shareItem, true)
                        }
                    }}
                    onDisableShare={async () => {
                        if ('filename' in shareItem) {
                            await setFileSharing(shareItem, false)
                        } else {
                            await setFolderSharing(shareItem, false)
                        }
                    }}
                />
            )}
        </div>
    )
}

export default Dashboard

