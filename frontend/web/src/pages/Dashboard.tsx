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
import { useNavigate } from 'react-router-dom'
import '../App.css'
import '../css/Dashbord.css'
import { loadUserSettings, type SettingsState } from './settingsPreferences'
import {
    listFiles,
    listFolders,
    createFolder,
    listTrash,
    listSharedFilesWithMe,
    getStorageQuota,
    renameFolder,
    shareFolder,
    updateFileNote,
    type ApiFile,
    type ApiFolder,
    type StorageQuota,
} from '../api/files'
import { logout } from '../api/auth'
import { getUnlockedVaultSession } from '../api/session'
import type { CurrentUserResponse } from '../api/users'
import {
    encryptTextEnvelope,
    generateFileKey,
    unwrapFileKeyForUser,
    wrapFileKeyForUser,
} from '../crypto/fileEncryption'
import { DashboardContent } from './dashboard/DashboardContent'
import { DashboardModals } from './dashboard/DashboardModals'
import { DashboardSidebar } from './dashboard/DashboardSidebar'
import { DashboardTopbar } from './dashboard/DashboardTopbar'
import { hasFileExtension, mimeTypeForCreatedFile } from './dashboard/createdFile'
import {
    formatSizeValue,
    getFilterSummary,
    hasActiveFileFilters,
    matchesFileFilters,
    parseSizeInputToMb,
    parseSizeMb,
    sortFiles,
} from './dashboard/fileFilters'
import {
    applySavedOrder,
    clearLegacyLocalFileMetadata,
    loadActiveView,
    loadFileFilter,
    loadFileSort,
    loadFavouriteIds,
    saveActiveView,
    saveFileFilter,
    saveFileSort,
    saveOrderIds,
} from './dashboard/storage'
import { migratePlaintextFileMetadata } from './dashboard/metadataMigration'
import { useAnimatedItems } from './dashboard/hooks/useAnimatedItems'
import { useFileActions } from './dashboard/hooks/useFileActions'
import { useDashboardGroups } from './dashboard/hooks/useDashboardGroups'
import { useFilePreview } from './dashboard/hooks/useFilePreview'
import { useFileUpload } from './dashboard/hooks/useFileUpload'
import { useLayoutModeSwitch } from './dashboard/hooks/useLayoutModeSwitch'
import { useNavOrdering } from './dashboard/hooks/useNavOrdering'
import { useSidebarState } from './dashboard/hooks/useSidebarState'
import { useStorageSummary } from './dashboard/hooks/useStorageSummary'
import { decryptFilesMetadata, decryptFoldersMetadata } from './dashboard/encryptedMetadata'
import type { FileFilters, FileSortKey, FileTypeFilterKey, FileVisibilityFilterKey, Item, NavIndicator, ShareableItem, ViewKey } from './dashboard/types'

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
    const [currentUser, setCurrentUser] = useState<CurrentUserResponse | null>(null)
    const [displayName, setDisplayName] = useState('You')
    const [avatarUrl, setAvatarUrl] = useState('')
    const [noteItem, setNoteItem] = useState<Item | null>(null)
    const [noteSaving, setNoteSaving] = useState(false)
    const [folderCreateOpen, setFolderCreateOpen] = useState(false)
    const [folderNameDraft, setFolderNameDraft] = useState('')
    const [folderDescriptionDraft, setFolderDescriptionDraft] = useState('')
    const [folderSaving, setFolderSaving] = useState(false)
    const [fileCreateOpen, setFileCreateOpen] = useState(false)
    const [fileNameDraft, setFileNameDraft] = useState('Untitled.txt')
    const [fileSaving, setFileSaving] = useState(false)
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
    const searchInputRef = useRef<HTMLInputElement>(null)
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
        groupError,
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
        return folders.filter((folder) =>
            [folder.name, folder.description ?? ''].some((value) => value.toLowerCase().includes(normalizedQuery)),
        )
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

    const refreshQuota = useCallback(async () => {
        try {
            const [quotaData, fileData] = await Promise.all([getStorageQuota(), listFiles()])
            const visibleFileData = privateKey ? await decryptFilesMetadata(fileData, privateKey) : fileData
            if (privateKey) void migratePlaintextFileMetadata(fileData, privateKey)
            setQuota(quotaData)
            setStorageItems(visibleFileData)
            setFavouriteIds(new Set(fileData.filter((file) => file.is_favourite).map((file) => file.id)))
        } catch {
            setQuota(null)
        }
    }, [privateKey])

    const { ingestFiles, ingestFileArray } = useFileUpload({
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
        handlePermanentDelete,
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
        favouriteIds,
        refreshQuota,
        privateKey,
    })

    useEffect(() => {
        clearLegacyLocalFileMetadata()
    }, [])

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

                setCurrentUser(session.user)
                setPublicKey(session.user.public_key)
                setPrivateKey(session.privateKey)
                const localSettings = loadUserSettings(session.user)
                setDisplayName(localSettings.displayName || session.user.display_name || 'You')
                setAvatarUrl(localSettings.avatarUrl)
            })
            .catch(() => {
                if (active) {
                    setCurrentUser(null)
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
                if (view === 'groups' || view === 'calendar') {
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
                    const [visibleFileData, visibleFolderData] = await Promise.all([
                        decryptFilesMetadata(fileData, privateKey),
                        decryptFoldersMetadata(folderData, privateKey),
                    ])
                    if (view !== 'shared') void migratePlaintextFileMetadata(fileData, privateKey)
                    setItems(applySavedOrder(visibleFileData, view))
                    setFolders(visibleFolderData)
                    if (view === 'all' || view === 'favourites') {
                        setStorageItems(visibleFileData as ApiFile[])
                        setFavouriteIds(new Set(fileData.filter((file) => file.is_favourite).map((file) => file.id)))
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
        function onFindShortcut(e: KeyboardEvent) {
            const isFindShortcut =
                (e.ctrlKey || e.metaKey) &&
                !e.altKey &&
                !e.shiftKey &&
                (e.code === 'KeyF' || e.key.toLowerCase() === 'f')

            if (!isFindShortcut) return
            if (filePreview) return

            e.preventDefault()
            e.stopPropagation()
            setMenuOpen(false)
            closeSortMenu()
            closeFilterMenu()

            requestAnimationFrame(() => {
                searchInputRef.current?.focus()
                searchInputRef.current?.select()
            })
        }

        window.addEventListener('keydown', onFindShortcut, { capture: true })
        return () => window.removeEventListener('keydown', onFindShortcut, { capture: true })
    }, [closeFilterMenu, closeSortMenu, filePreview])

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

    function resetFileCreateDraft() {
        setFileCreateOpen(false)
        setFileNameDraft('Untitled.txt')
    }

    async function handleCreateFile() {
        const filename = fileNameDraft.trim()
        if (!filename || !hasFileExtension(filename) || fileSaving) return

        setFileSaving(true)
        setError(null)
        try {
            const file = new File([''], filename, {
                type: mimeTypeForCreatedFile(filename),
                lastModified: Date.now(),
            })
            const [created] = await ingestFileArray([file])
            if (created) {
                resetFileCreateDraft()
                await handleFilePreview(created, { startEditing: true })
            }
        } finally {
            setFileSaving(false)
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
        if (!privateKey) {
            setError('Private key is locked. Sign in again to save encrypted notes.')
            setNoteSaving(false)
            return
        }

        try {
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
            setError(e instanceof Error ? e.message : 'Could not save the note.')
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
        const description = folderDescriptionDraft.trim()
        if (!name || folderSaving) return

        setFolderSaving(true)
        setError(null)
        if (!publicKey) {
            setError('Encryption key unavailable. Sign in again before creating folders.')
            setFolderSaving(false)
            return
        }

        try {
            const folderKey = await generateFileKey()
            const folder = await createFolder({
                name: await encryptTextEnvelope(name, folderKey),
                description: description ? await encryptTextEnvelope(description, folderKey) : null,
                wrappedKey: await wrapFileKeyForUser(folderKey, publicKey),
                parentFolderId: activeFolderId,
            })
            const visibleFolder = { ...folder, name, description: description || null }
            setFolders((current) => [...current, visibleFolder].sort((a, b) => a.name.localeCompare(b.name)))
            setFolderNameDraft('')
            setFolderDescriptionDraft('')
            setFolderCreateOpen(false)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the folder.')
        } finally {
            setFolderSaving(false)
        }
    }

    async function handleRenameFolder(folder: ApiFolder, name: string, description: string | null) {
        const previousName = folder.name
        const previousDescription = folder.description ?? null
        const nextName = name.trim()
        const nextDescription = description?.trim() || null
        if (!nextName || (nextName === previousName && nextDescription === previousDescription)) return

        setError(null)
        if (folder.encrypted_key && !privateKey) {
            setError('Private key is locked. Sign in again to update encrypted folders.')
            return
        }
        const unlockedPrivateKey = privateKey

        setFolders((current) =>
            current
                .map((item) =>
                    item.id === folder.id ? { ...item, name: nextName, description: nextDescription, updated_at: new Date().toISOString() } : item,
                )
                .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setFolderTrail((current) =>
            current.map((item) =>
                item.id === folder.id ? { ...item, name: nextName, description: nextDescription, updated_at: new Date().toISOString() } : item,
            ),
        )

        try {
            let storedName = nextName
            let storedDescription = nextDescription
            if (folder.encrypted_key && unlockedPrivateKey) {
                const folderKey = await unwrapFileKeyForUser(folder.encrypted_key, unlockedPrivateKey)
                storedName = await encryptTextEnvelope(nextName, folderKey)
                storedDescription = nextDescription ? await encryptTextEnvelope(nextDescription, folderKey) : null
            }

            const renamed = await renameFolder(folder.id, storedName, storedDescription)
            const visibleRenamed = { ...renamed, name: nextName, description: nextDescription, encrypted_key: folder.encrypted_key }
            setFolders((current) =>
                current.map((item) => (item.id === folder.id ? visibleRenamed : item)).sort((a, b) => a.name.localeCompare(b.name)),
            )
            setFolderTrail((current) => current.map((item) => (item.id === folder.id ? visibleRenamed : item)))
            setShareItem((current) => {
                if (!current || 'filename' in current || current.id !== folder.id) return current
                return visibleRenamed
            })
        } catch (e) {
            setFolders((current) =>
                current
                    .map((item) =>
                        item.id === folder.id ? { ...item, name: previousName, description: previousDescription, updated_at: folder.updated_at } : item,
                    )
                    .sort((a, b) => a.name.localeCompare(b.name)),
            )
            setFolderTrail((current) =>
                current.map((item) =>
                    item.id === folder.id ? { ...item, name: previousName, description: previousDescription, updated_at: folder.updated_at } : item,
                ),
            )
            setError(e instanceof Error ? e.message : 'Could not update that folder.')
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
            const visibleShared = { ...shared, name: folder.name, description: folder.description, encrypted_key: folder.encrypted_key }
            setFolders((current) => current.map((item) => (item.id === folder.id ? visibleShared : item)))
            setShareItem(visibleShared)
            return visibleShared
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

    function handleSettingsSave(profile: SettingsState) {
        setDisplayName(profile.displayName || 'You')
        setAvatarUrl(profile.avatarUrl)
        setCurrentUser((current) =>
            current
                ? {
                      ...current,
                      display_name: profile.displayName || null,
                      avatar_url: profile.avatarUrl || null,
                      default_view: profile.defaultView,
                      layout_mode: profile.layoutMode,
                      upload_protection: profile.uploadProtection,
                      compact_metadata: profile.compactMetadata,
                      device_lock: profile.deviceLock,
                      sync_on_metered: profile.syncOnMetered,
                      trash_retention_days: profile.trashRetentionDays,
                  }
                : current,
        )
    }

    return (
        <div
            className={`shell ${sidebarHidden ? 'is-sidebar-hidden' : ''} ${sidebarCompact ? 'is-sidebar-compact' : ''}`}
            style={{ '--sidebar-width': sidebarHidden ? '0px' : `${sidebarWidth}px` } as React.CSSProperties}
        >
            <DashboardSidebar
                sidebarHidden={sidebarHidden}
                navListRef={navListRef}
                navItemRefs={navItemRefs}
                navIndicator={navIndicator}
                navIndicatorPulling={navIndicatorPulling}
                navOrder={navOrder}
                view={view}
                draggedNavKey={draggedNavKey}
                dropNavTarget={dropNavTarget}
                quota={quota}
                usedPct={usedPct}
                storageStatus={storageStatus}
                storageStatusText={storageStatusText}
                storageBreakdown={storageBreakdown}
                storageBreakdownTotal={storageBreakdownTotal}
                onHideSidebar={() => setSidebarHidden(true)}
                onStartSidebarResize={startSidebarResize}
                onSelectNavView={selectNavView}
                onNavDragStart={handleNavDragStart}
                onNavDragEnter={handleNavDragEnter}
                onNavDragLeave={handleNavDragLeave}
                onNavDrop={handleNavDrop}
                onNavDragEnd={handleNavDragEnd}
                onOpenSettings={() => setSettingsOpen(true)}
            />

            <div className="shell__main">
                <DashboardTopbar
                    sidebarHidden={sidebarHidden}
                    searchInputRef={searchInputRef}
                    query={query}
                    displayName={displayName}
                    avatarUrl={avatarUrl}
                    menuOpen={menuOpen}
                    menuRef={menuRef}
                    onShowSidebar={() => setSidebarHidden(false)}
                    onQueryChange={setQuery}
                    onToggleMenu={() => setMenuOpen((value) => !value)}
                    onSignOut={() => void signOut()}
                />

                <DashboardContent
                    view={view}
                    dragActive={dragActive}
                    isFileDrag={isFileDrag}
                    onDragActiveChange={setDragActive}
                    onDrop={onDrop}
                    sortMenuRef={sortMenuRef}
                    filterMenuRef={filterMenuRef}
                    sortMenuOpen={sortMenuOpen}
                    sortMenuClosing={sortMenuClosing}
                    filterMenuOpen={filterMenuOpen}
                    filterMenuClosing={filterMenuClosing}
                    sortKey={sortKey}
                    layoutMode={layoutMode}
                    layoutSwitchTarget={layoutSwitchTarget}
                    filterSummary={filterSummary}
                    query={query}
                    fileFilters={fileFilters}
                    hasActiveFilter={hasActiveFilter}
                    sizeSliderMax={sizeSliderMax}
                    sizeSliderMinValue={sizeSliderMinValue}
                    sizeSliderMaxValue={sizeSliderMaxValue}
                    sizeSliderMinPct={sizeSliderMinPct}
                    sizeSliderMaxPct={sizeSliderMaxPct}
                    onToggleSortMenu={toggleSortMenu}
                    onCloseSortMenu={closeSortMenu}
                    onSortKeyChange={setSortKey}
                    onToggleFilterMenu={toggleFilterMenu}
                    onCloseFilterMenu={closeFilterMenu}
                    onQueryChange={setQuery}
                    onClearFileTypes={() => setFileFilters((current) => ({ ...current, types: [] }))}
                    onToggleFileType={toggleFileTypeFilter}
                    onVisibilityChange={updateVisibilityFilter}
                    onSizeInputChange={updateSizeFilter}
                    onSizeSliderChange={updateSizeSlider}
                    onExcludedExtensionsChange={updateExcludedExtensions}
                    onModifiedDateChange={updateModifiedDateFilter}
                    onClearFilters={clearFileFilters}
                    onLayoutModeChange={changeLayoutMode}
                    onOpenFileCreate={() => setFileCreateOpen(true)}
                    onOpenFolderCreate={() => setFolderCreateOpen(true)}
                    onUploadChange={onUploadChange}
                    folderTrail={folderTrail}
                    onOpenRoot={openFolderRoot}
                    onOpenFolderAt={(folder, index) => {
                        const nextTrail = folderTrail.slice(0, index + 1)
                        setFolderTrail(nextTrail)
                        setActiveFolderId(folder.id)
                        setQuery('')
                    }}
                    onOpenParent={openFolderParent}
                    error={error}
                    loading={loading}
                    visibleItems={visibleItems}
                    renderedItems={renderedItems}
                    visibleFolders={visibleFolders}
                    storageItems={storageItems}
                    exitingIds={animatedFiles.exitingIds}
                    pendingIds={pendingIds}
                    favouriteIds={favouriteIds}
                    currentUser={currentUser}
                    groups={groups}
                    groupError={groupError}
                    activeGroupId={activeGroupId}
                    groupCreateOpen={groupCreateOpen}
                    groupInviteOpen={groupInviteOpen}
                    onCreateGroup={createGroup}
                    onOpenGroupCreate={() => {
                        setGroupCreateOpen(true)
                        setGroupInviteOpen(false)
                    }}
                    onCloseGroupCreate={() => setGroupCreateOpen(false)}
                    onOpenGroup={openGroup}
                    onBackToGroups={backToGroups}
                    onOpenGroupInvite={() => {
                        setGroupInviteOpen(true)
                        setGroupCreateOpen(false)
                    }}
                    onCloseGroupInvite={() => setGroupInviteOpen(false)}
                    onInvite={addGroupInvite}
                    onRemoveInvite={removeGroupInvite}
                    onUpdateGroup={updateGroup}
                    onDeleteGroup={deleteGroup}
                    draggedCardId={draggedCardId}
                    dropTargetId={dropTargetId}
                    onOpenFolder={openFolder}
                    onShareFolder={handleShareFolder}
                    onRenameFolder={handleRenameFolder}
                    onDelete={handleDelete}
                    onRestore={handleRestore}
                    onPermanentDelete={handlePermanentDelete}
                    onDownload={handleDownload}
                    onPreview={handleFilePreview}
                    onRename={handleRename}
                    onShare={handleShare}
                    onNote={setNoteItem}
                    onToggleFavourite={toggleFavourite}
                    onDragStartCard={handleCardDragStart}
                    onDragEnterCard={handleCardDragEnter}
                    onDragLeaveCard={handleCardDragLeave}
                    onDropCard={handleCardDrop}
                    onDragEndCard={handleCardDragEnd}
                />
            </div>
            <DashboardModals
                filePreview={filePreview}
                onCloseFilePreview={closeFilePreview}
                onDownload={handleDownload}
                onSaveTextFile={handleSaveTextFile}
                settingsOpen={settingsOpen}
                currentUser={currentUser}
                onCloseSettings={() => setSettingsOpen(false)}
                onSaveSettings={handleSettingsSave}
                fileCreateOpen={fileCreateOpen}
                currentFolderName={folderTrail.at(-1)?.name ?? 'All files'}
                fileNameDraft={fileNameDraft}
                fileSaving={fileSaving}
                onFileNameChange={setFileNameDraft}
                onCreateFile={() => void handleCreateFile()}
                onCloseFileCreate={resetFileCreateDraft}
                folderCreateOpen={folderCreateOpen}
                folderNameDraft={folderNameDraft}
                folderDescriptionDraft={folderDescriptionDraft}
                folderSaving={folderSaving}
                onFolderNameChange={setFolderNameDraft}
                onFolderDescriptionChange={setFolderDescriptionDraft}
                onCreateFolder={() => void handleCreateFolder()}
                onCloseFolderCreate={() => {
                    setFolderCreateOpen(false)
                    setFolderNameDraft('')
                    setFolderDescriptionDraft('')
                }}
                noteItem={noteItem}
                noteSaving={noteSaving}
                onCloseNote={() => setNoteItem(null)}
                onSaveNote={handleSaveNote}
                shareItem={shareItem}
                shareLoading={shareLoading}
                privateKey={privateKey}
                groups={groups}
                onCloseShare={() => setShareItem(null)}
                onSetFileSharing={setFileSharing}
                onSetFolderSharing={setFolderSharing}
            />
        </div>
    )
}

export default Dashboard

