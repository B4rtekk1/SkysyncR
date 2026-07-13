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
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Dashbord.css'
import ThemeToggle from '../components/ThemeToggle'
import SettingsModal from './Settings'
import {
    listFiles,
    listTrash,
    listSharedFilesWithMe,
    getStorageQuota,
    softDeleteFile,
    restoreFile,
    renameFile,
    shareFile,
    uploadFile,
    type ApiFile,
    type StorageQuota,
} from '../api/files'
import { logout } from '../api/auth'
import { getCurrentUser } from '../api/users'
import {
    generateFileKey,
    encryptFile,
    wrapFileKeyForUser,
} from '../crypto/fileEncryption'
import { loadActivePrivateKey } from '../crypto/storage'
import { EmptyPane } from './dashboard/EmptyPane'
import { FileCard } from './dashboard/FileCard'
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
    kindFromFile,
} from './dashboard/fileUtils'
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
    saveFavouriteIds,
    saveLocalFileMetadata,
    saveOrderIds,
} from './dashboard/storage'
import { useAnimatedItems } from './dashboard/hooks/useAnimatedItems'
import { useDashboardGroups } from './dashboard/hooks/useDashboardGroups'
import { useFilePreview } from './dashboard/hooks/useFilePreview'
import { useLayoutModeSwitch } from './dashboard/hooks/useLayoutModeSwitch'
import { useNavOrdering } from './dashboard/hooks/useNavOrdering'
import { useSidebarState } from './dashboard/hooks/useSidebarState'
import { useStorageSummary } from './dashboard/hooks/useStorageSummary'
import type { FileFilters, FileSortKey, FileTypeFilterKey, FileVisibilityFilterKey, Item, NavIndicator, ViewKey } from './dashboard/types'

const FILE_SORT_LABELS: Record<FileSortKey, string> = {
    manual: 'Manual order',
    'name-asc': 'Name A-Z',
    'name-desc': 'Name Z-A',
    'updated-desc': 'Newest first',
    'updated-asc': 'Oldest first',
    'size-desc': 'Largest first',
    'size-asc': 'Smallest first',
}

const FILE_TYPE_FILTER_LABELS: Record<FileTypeFilterKey, string> = {
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

const FILE_TYPE_FILTER_OPTIONS: FileTypeFilterKey[] = [
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

const FILE_VISIBILITY_LABELS: Record<FileVisibilityFilterKey, string> = {
    any: 'Any',
    public: 'Shared',
    private: 'Not shared',
}

function parseSizeMb(value: string) {
    const normalized = value.trim().replace(',', '.')
    if (!normalized) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function formatSizeValue(value: number) {
    if (!Number.isFinite(value)) return ''
    const rounded = Math.round(value * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatSizeFromKb(valueKb: number) {
    return valueKb >= 1024 ? `${formatSizeValue(valueKb / 1024)} MB` : `${Math.round(valueKb)} KB`
}

function formatSizeInputValue(valueMb: string) {
    const parsed = parseSizeMb(valueMb)
    return parsed === null ? '' : formatSizeFromKb(parsed * 1024)
}

function parseSizeInputToMb(value: string) {
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

function parseExcludedExtensions(value: string) {
    return value
        .split(/[\s,;]+/)
        .map((extension) => extension.trim().toLowerCase().replace(/^\./, ''))
        .filter(Boolean)
}

function hasActiveFileFilters(filters: FileFilters) {
    return (
        filters.types.length > 0 ||
        filters.visibility !== 'any' ||
        filters.minSizeMb.trim() !== '' ||
        filters.maxSizeMb.trim() !== '' ||
        filters.excludedExtensions.trim() !== '' ||
        filters.modifiedFrom !== '' ||
        filters.modifiedTo !== ''
    )
}

function getFilterSummary(filters: FileFilters) {
    const excludedExtensions = parseExcludedExtensions(filters.excludedExtensions)
    const activeParts = [
        filters.types.length > 0 ? `${filters.types.length} type${filters.types.length > 1 ? 's' : ''}` : null,
        filters.visibility !== 'any' ? FILE_VISIBILITY_LABELS[filters.visibility] : null,
        filters.minSizeMb.trim() || filters.maxSizeMb.trim() ? 'Size' : null,
        excludedExtensions.length > 0 ? `${excludedExtensions.length} excluded` : null,
        filters.modifiedFrom || filters.modifiedTo ? 'Modified' : null,
    ].filter(Boolean)

    return activeParts.length > 0 ? activeParts.join(' · ') : 'All files'
}

function matchesFileFilters(item: Item, filters: FileFilters) {
    if (filters.types.length > 0 && !filters.types.includes(kindFromFile(item.filename, item.mime_type))) {
        return false
    }
    if (filters.visibility === 'public' && !item.is_public) return false
    if (filters.visibility === 'private' && item.is_public) return false

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

function sortFiles(items: Item[], sortKey: FileSortKey) {
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

function Dashboard() {
    const [view, setView] = useState<ViewKey>(() => loadActiveView())
    const [items, setItems] = useState<Item[]>([])
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
    const [shareItem, setShareItem] = useState<Item | null>(null)
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

                return { ...updated, filename: current.filename, mime_type: current.mime_type }
            }),
        )
        setItems((prev) =>
            prev.map((current) =>
                current.id === updated.id
                    ? { ...updated, filename: current.filename, mime_type: current.mime_type }
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

            if (!publicKey) {
                setItems((prev) => prev.filter((i) => i.id !== tempId))
                setPendingIds((prev) => {
                    const next = new Set(prev)
                    next.delete(tempId)
                    return next
                })
                setError('Encryption key unavailable. Sign in again before uploading.')
                continue
            }

            try {
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

    async function handleRename(item: Item, filename: string) {
        const previousName = item.filename
        const nextName = filename.trim()
        if (!nextName || nextName === previousName) return

        setError(null)
        setItems((prev) =>
            prev.map((current) =>
                current.id === item.id ? { ...current, filename: nextName, updated_at: new Date().toISOString() } : current,
            ),
        )

        try {
            const renamed = await renameFile(item.id, nextName)
            const visibleRenamed = { ...renamed, filename: nextName, mime_type: item.mime_type }
            saveLocalFileMetadata(item.id, {
                filename: nextName,
                mime_type: item.mime_type,
            })
            setItems((prev) => prev.map((current) => (current.id === item.id ? visibleRenamed : current)))
            setStorageItems((prev) => prev.map((current) => (current.id === item.id ? visibleRenamed : current)))
        } catch (e) {
            setItems((prev) =>
                prev.map((current) =>
                    current.id === item.id ? { ...current, filename: previousName, updated_at: item.updated_at } : current,
                ),
            )
            setError(e instanceof Error ? e.message : 'Could not rename that file.')
            throw e
        }
    }

    function handleShare(item: Item) {
        setError(null)
        setShareItem(item)
    }

    async function setFileSharing(item: Item, isPublic: boolean) {
        setShareLoading(true)
        setError(null)
        try {
            const shared = await shareFile(item.id, isPublic)
            const visibleShared = { ...shared, filename: item.filename, mime_type: item.mime_type }
            setItems((prev) => prev.map((current) => (current.id === item.id ? visibleShared : current)))
            setStorageItems((prev) => prev.map((current) => (current.id === item.id ? visibleShared : current)))
            setShareItem(visibleShared)
            return visibleShared
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update sharing for that file.')
            throw e
        } finally {
            setShareLoading(false)
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

                                    {filterMenuOpen && (
                                        <div
                                            className={`file-filter__modal ${
                                                filterMenuClosing ? 'is-closing' : 'is-opening'
                                            }`}
                                            onMouseDown={(e) => {
                                                if (e.target === e.currentTarget) closeFilterMenu()
                                            }}
                                        >
                                            <div
                                                className="file-filter__dialog"
                                                role="dialog"
                                                aria-modal="true"
                                                aria-labelledby="file-filter-title"
                                            >
                                                <div className="file-filter__modal-head">
                                                    <div>
                                                        <h2 id="file-filter-title">Filter files</h2>
                                                        <span>{filterSummary}</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="file-filter__close"
                                                        onClick={closeFilterMenu}
                                                        aria-label="Close filters"
                                                    >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                            <path
                                                                d="m6 6 12 12M18 6 6 18"
                                                                stroke="currentColor"
                                                                strokeWidth="1.9"
                                                                strokeLinecap="round"
                                                            />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <div className="file-filter__modal-body">
                                                    <div className="file-filter__section file-filter__section--search">
                                                        <div className="file-filter__section-head">
                                                            <span>Search</span>
                                                        </div>
                                                        <label className="file-filter__search">
                                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                                <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                                                                <path d="M20 20l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" />
                                                            </svg>
                                                            <input
                                                                type="text"
                                                                placeholder="Search files"
                                                                value={query}
                                                                onChange={(e) => setQuery(e.target.value)}
                                                            />
                                                        </label>
                                                    </div>
                                                    <div className="file-filter__modal-grid">
                                                        <div className="file-filter__section">
                                                            <div className="file-filter__section-head">
                                                                <span>File types</span>
                                                                {fileFilters.types.length > 0 && (
                                                                    <button
                                                                        type="button"
                                                                        className="file-filter__link"
                                                                        onClick={() => setFileFilters((current) => ({ ...current, types: [] }))}
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="file-filter__type-grid">
                                                                {FILE_TYPE_FILTER_OPTIONS.map((type) => (
                                                                    <label
                                                                        key={type}
                                                                        className={`file-filter__check ${
                                                                            fileFilters.types.includes(type) ? 'is-selected' : ''
                                                                        }`}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={fileFilters.types.includes(type)}
                                                                            onChange={() => toggleFileTypeFilter(type)}
                                                                        />
                                                                        <span>{FILE_TYPE_FILTER_LABELS[type]}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div className="file-filter__section">
                                                            <div className="file-filter__section-head">
                                                                <span>Sharing</span>
                                                            </div>
                                                            <div className="file-filter__segments">
                                                                {(Object.keys(FILE_VISIBILITY_LABELS) as FileVisibilityFilterKey[]).map(
                                                                    (visibility) => (
                                                                        <button
                                                                            key={visibility}
                                                                            type="button"
                                                                            className={`file-filter__segment ${
                                                                                fileFilters.visibility === visibility ? 'is-selected' : ''
                                                                            }`}
                                                                            onClick={() => updateVisibilityFilter(visibility)}
                                                                        >
                                                                            {FILE_VISIBILITY_LABELS[visibility]}
                                                                        </button>
                                                                    ),
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="file-filter__section">
                                                            <div className="file-filter__section-head">
                                                                <span>Size range</span>
                                                                <span>
                                                                    {formatSizeFromKb(sizeSliderMinValue)} - {formatSizeFromKb(sizeSliderMaxValue)}
                                                                </span>
                                                            </div>
                                                            <div className="file-filter__range-stack">
                                                                <div className="file-filter__range-labels">
                                                                    <span>
                                                                        Min {formatSizeFromKb(sizeSliderMinValue)}
                                                                    </span>
                                                                    <span>
                                                                        Max {formatSizeFromKb(sizeSliderMaxValue)}
                                                                    </span>
                                                                </div>
                                                                <div
                                                                    className="file-filter__range-dual"
                                                                    style={
                                                                        {
                                                                            '--range-min': `${sizeSliderMinPct}%`,
                                                                            '--range-max': `${sizeSliderMaxPct}%`,
                                                                        } as React.CSSProperties
                                                                    }
                                                                >
                                                                    <input
                                                                        type="range"
                                                                        min="0"
                                                                        max={sizeSliderMax}
                                                                        value={sizeSliderMinValue}
                                                                        onChange={(e) => updateSizeSlider('minSizeMb', e.target.value)}
                                                                        aria-label="Minimum file size"
                                                                    />
                                                                    <input
                                                                        type="range"
                                                                        min="0"
                                                                        max={sizeSliderMax}
                                                                        value={sizeSliderMaxValue}
                                                                        onChange={(e) => updateSizeSlider('maxSizeMb', e.target.value)}
                                                                        aria-label="Maximum file size"
                                                                    />
                                                                </div>
                                                                <div className="file-filter__size-row">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Min"
                                                                        value={formatSizeInputValue(fileFilters.minSizeMb)}
                                                                        onChange={(e) => updateSizeFilter('minSizeMb', e.target.value)}
                                                                        aria-label="Minimum file size"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Max"
                                                                        value={formatSizeInputValue(fileFilters.maxSizeMb)}
                                                                        onChange={(e) => updateSizeFilter('maxSizeMb', e.target.value)}
                                                                        aria-label="Maximum file size"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="file-filter__section">
                                                            <div className="file-filter__section-head">
                                                                <span>Exclude extensions</span>
                                                            </div>
                                                            <input
                                                                className="file-filter__text-input"
                                                                type="text"
                                                                placeholder="exe, zip, .tmp"
                                                                value={fileFilters.excludedExtensions}
                                                                onChange={(e) => updateExcludedExtensions(e.target.value)}
                                                                aria-label="Excluded file extensions"
                                                            />
                                                        </div>

                                                        <div className="file-filter__section">
                                                            <div className="file-filter__section-head">
                                                                <span>Modified date</span>
                                                            </div>
                                                            <div className="file-filter__size-row">
                                                                <input
                                                                    type="date"
                                                                    value={fileFilters.modifiedFrom}
                                                                    onChange={(e) => updateModifiedDateFilter('modifiedFrom', e.target.value)}
                                                                    aria-label="Modified from"
                                                                />
                                                                <input
                                                                    type="date"
                                                                    value={fileFilters.modifiedTo}
                                                                    onChange={(e) => updateModifiedDateFilter('modifiedTo', e.target.value)}
                                                                    aria-label="Modified to"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="file-filter__footer">
                                                    <button
                                                        type="button"
                                                        className="file-filter__clear"
                                                        onClick={clearFileFilters}
                                                        disabled={!hasActiveFilter}
                                                    >
                                                        Reset filters
                                                    </button>
                                                    <button type="button" className="file-filter__done" onClick={closeFilterMenu}>
                                                        Done
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
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

                    {!loading && view === 'all' && visibleItems.length === 0 && renderedItems.length === 0 && (
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
                                    onPreview={view !== 'trash' ? handleFilePreview : undefined}
                                    onRename={
                                        view === 'all' || view === 'favourites' ? handleRename : undefined
                                    }
                                    onShare={
                                        view === 'all' || view === 'favourites' ? handleShare : undefined
                                    }
                                    isFavourite={favouriteIds.has(item.id)}
                                    onToggleFavourite={
                                        view === 'all' || view === 'favourites' ? toggleFavourite : undefined
                                    }
                                    draggable={sortKey === 'manual' && !pendingIds.has(item.id) && !isSearchExiting}
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
            {filePreview && (
                <ImagePreviewModal
                    preview={filePreview}
                    onClose={closeFilePreview}
                    onDownload={handleDownload}
                    onSaveText={handleSaveTextFile}
                />
            )}
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            {shareItem && (
                <ShareFileModal
                    item={shareItem}
                    shareUrl={
                        shareItem.is_public && shareItem.share_token
                            ? `${window.location.origin}/share/${shareItem.share_token}`
                            : null
                    }
                    loading={shareLoading}
                    onClose={() => setShareItem(null)}
                    onEnableShare={async () => {
                        await setFileSharing(shareItem, true)
                    }}
                    onDisableShare={async () => {
                        await setFileSharing(shareItem, false)
                    }}
                />
            )}
        </div>
    )
}

export default Dashboard

