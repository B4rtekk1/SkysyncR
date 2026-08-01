import React, {
    useEffect,
    useMemo,
    useCallback,
    useState,
    type ChangeEvent,
    type DragEvent,
} from 'react'
import { useNavigate } from '../router'
import '../App.css'
import '../css/dashboard.css'
import type { Item, ShareableItem, ViewKey } from './dashboard/types'
import { deleteFolder, getStorageQuota, listFiles, listFolders, listTrash, moveFile, moveFolder, permanentlyDeleteFile, permanentlyDeleteFolder, restoreFolder, restoreFolderPoint, shareFile, shareFolder, type ApiFile, type ApiFolder, type FolderPointRestoreResult } from '../api/files'
import type { ReauthenticationPayload } from '../api/users'
import { addFileTag, createTag, removeFileTag, type Tag } from '../api/tags'
import { createCalendarEntry } from '../api/calendar'
import { DashboardContent } from './dashboard/components/DashboardContent'
import { DashboardModals } from './dashboard/components/DashboardModals'
import { DashboardSidebar } from './dashboard/components/DashboardSidebar'
import { DashboardTopbar } from './dashboard/components/DashboardTopbar'
import { DashboardTour } from './dashboard/components/DashboardTour'
import {
    loadActiveView,
    saveActiveView,
} from './dashboard/storage'
import { useAnimatedItems } from './dashboard/hooks/useAnimatedItems'
import { useFileActions } from './dashboard/hooks/useFileActions'
import { useCreateFile } from './dashboard/hooks/useCreateFile'
import { useDashboardGroups } from './dashboard/hooks/useDashboardGroups'
import { useDashboardData } from './dashboard/hooks/useDashboardData'
import { useDashboardSession } from './dashboard/hooks/useDashboardSession'
import { useFilePreview } from './dashboard/hooks/useFilePreview'
import { useFileFilterControls } from './dashboard/hooks/useFileFilterControls'
import { useFileUpload } from './dashboard/hooks/useFileUpload'
import { useDownloadTransfers } from './dashboard/hooks/useDownloadTransfers'
import { useFolderActions } from './dashboard/hooks/useFolderActions'
import { useFolderDownload } from './dashboard/hooks/useFolderDownload'
import { useLayoutModeSwitch } from './dashboard/hooks/useLayoutModeSwitch'
import { FILE_CARD_DRAG_MIME, useManualCardOrdering } from './dashboard/hooks/useManualCardOrdering'
import { useDashboardMenus } from './dashboard/hooks/useDashboardMenus'
import { useNavIndicator } from './dashboard/hooks/useNavIndicator'
import { useNavOrdering } from './dashboard/hooks/useNavOrdering'
import { useNoteActions } from './dashboard/hooks/useNoteActions'
import { useSidebarState } from './dashboard/hooks/useSidebarState'
import { useStorageSummary } from './dashboard/hooks/useStorageSummary'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { decryptFilesMetadata, decryptFoldersMetadata } from './dashboard/encryptedMetadata'

function isTextEditingTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function Dashboard() {
    const navigate = useNavigate()
    const [view, setView] = useState<ViewKey>(() => loadActiveView())
    const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [dragActive, setDragActive] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [shareItem, setShareItem] = useState<ShareableItem | null>(null)
    const [shareLoading, setShareLoading] = useState(false)
    const [moveItem, setMoveItem] = useState<Item | null>(null)
    const [moveSaving, setMoveSaving] = useState(false)
    const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set())
    const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(() => new Set())
    const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(null)
    const [pathDropTargetId, setPathDropTargetId] = useState<string | null>(null)
    const online = useNetworkStatus()
    const normalizedQuery = query.trim().toLowerCase()
    const {
        navOrder,
        draggedNavKey,
        dropNavTarget,
        handleNavDragStart,
        handleNavDragEnter,
        handleNavDragLeave,
        handleNavDrop,
        handleNavDragEnd,
        moveNavItem,
    } = useNavOrdering()
    const {
        sidebarWidth,
        sidebarHidden,
        sidebarCompact,
        sidebarStorageCompact,
        setSidebarHidden,
        startSidebarResize,
        resizeSidebarWithKeyboard,
    } = useSidebarState()
    const {
        navListRef,
        navItemRefs,
        navIndicator,
        navIndicatorPulling,
    } = useNavIndicator(view, navOrder, sidebarWidth, sidebarHidden)
    const { layoutMode, layoutSwitchTarget, changeLayoutMode } = useLayoutModeSwitch()
    const {
        groups,
        incomingInvites,
        activeGroupId,
        groupCreateOpen,
        groupInviteOpen,
        setGroupCreateOpen,
        setGroupInviteOpen,
        createGroup,
        openGroup,
        backToGroups,
        addGroupInvite,
        acceptGroupInvite,
        declineGroupInvite,
        updateMemberRole,
        removeGroupMember,
        leaveGroup,
        updateGroup,
        deleteGroup,
        removeGroupInvite,
        groupError,
    } = useDashboardGroups()
    const {
        currentUser,
        displayName,
        avatarUrl,
        publicKey,
        privateKey,
        sessionLoading,
        signOut,
        handleSettingsSave,
    } = useDashboardSession(navigate)
    const {
        items,
        setItems,
        folders,
        setFolders,
        pendingIds,
        setPendingIds,
        loading,
        error,
        setError,
        quota,
        setQuota,
        storageItems,
        setStorageItems,
        tags,
        setTags,
        fileTagsByFileId,
        favouriteIds,
        setFavouriteIds,
        folderFavouriteIds,
        setFolderFavouriteIds,
        refreshQuota,
        offlineSnapshot,
        handleFileUpdated,
        updateFileTags,
    } = useDashboardData({ view, activeFolderId, privateKey, userId: currentUser?.id ?? null })

    const {
        downloadTransfers,
        startDownloadTransfer,
        updateDownloadTransfer,
        removeDownloadTransfer,
    } = useDownloadTransfers()
    const { filePreview, closeFilePreview, handleDownload, handleFilePreview, handleSaveTextFile } = useFilePreview(
        privateKey,
        publicKey,
        setError,
        handleFileUpdated,
        { startDownloadTransfer, updateDownloadTransfer },
    )
    const { downloadFolder } = useFolderDownload(privateKey, setError)
    const {
        menuOpen,
        setMenuOpen,
        sortMenuOpen,
        sortMenuClosing,
        filterMenuOpen,
        filterMenuClosing,
        menuRef,
        sortMenuRef,
        filterMenuRef,
        searchInputRef,
        closeSortMenu,
        closeFilterMenu,
        toggleSortMenu,
        toggleFilterMenu,
    } = useDashboardMenus({ filePreviewOpen: Boolean(filePreview) })
    const visibleFolders = useMemo(() => {
        if (view !== 'all' && view !== 'favourites' && view !== 'recent' && view !== 'security' && view !== 'trash') return []
        return folders
            .filter((folder) => (view === 'favourites' ? folderFavouriteIds.has(folder.id) : true))
            .filter((folder) =>
                [folder.name, folder.description ?? ''].some((value) => value.toLowerCase().includes(normalizedQuery)),
            )
    }, [folderFavouriteIds, folders, normalizedQuery, view])
    const {
        sortKey,
        setSortKey,
        fileFilters,
        ownerOptions,
        folderOptions,
        hasActiveFilter,
        filterSummary,
        sortedItems,
        sizeSliderMax,
        sizeSliderMinValue,
        sizeSliderMaxValue,
        sizeSliderMinPct,
        sizeSliderMaxPct,
        clearFileTypes,
        toggleFileTypeFilter,
        updateVisibilityFilter,
        updateOwnerFilter,
        updateFolderFilter,
        updateTagFilter,
        updateSizeFilter,
        updateSizeSlider,
        updateExcludedExtensions,
        updateModifiedDateFilter,
        updateNoteQuery,
        clearFileFilters,
    } = useFileFilterControls(items, tags, fileTagsByFileId, folders, currentUser)
    const tagSearchTextByItemId = useMemo(() => {
        return new Map(
            Array.from(fileTagsByFileId.entries()).map(([fileId, fileTags]) => [
                fileId,
                fileTags.map((tag) => tag.name).join(' '),
            ]),
        )
    }, [fileTagsByFileId])
    const { visibleItems, renderedItems, animatedFiles } = useAnimatedItems({
        items: sortedItems,
        view,
        favouriteIds,
        normalizedQuery,
        searchTextByItemId: tagSearchTextByItemId,
    })
    const visibleFileIds = useMemo(() => renderedItems.filter((item) => !pendingIds.has(item.id)).map((item) => item.id), [pendingIds, renderedItems])
    const visibleFolderIds = useMemo(() => visibleFolders.map((folder) => folder.id), [visibleFolders])
    const selectedCount = selectedFileIds.size + selectedFolderIds.size
    const allVisibleSelected = useMemo(() => {
        const selectableFileIds = view === 'all' || view === 'favourites' || view === 'trash' ? visibleFileIds : []
        const selectableFolderIds = view === 'all' || view === 'favourites' || view === 'trash' ? visibleFolderIds : []
        const total = selectableFileIds.length + selectableFolderIds.length
        if (total === 0) return false
        return selectableFileIds.every((id) => selectedFileIds.has(id)) && selectableFolderIds.every((id) => selectedFolderIds.has(id))
    }, [selectedFileIds, selectedFolderIds, view, visibleFileIds, visibleFolderIds])
    const moveTargets = useMemo(
        () => visibleFolders.filter((folder) => !selectedFolderIds.has(folder.id)),
        [selectedFolderIds, visibleFolders],
    )
    const requestReauthentication = useCallback((action: string): ReauthenticationPayload | null => {
        const password = window.prompt(`Confirm your password to ${action}.`)
        if (!password) return null
        const totpCode = window.prompt('Enter your 6-digit authenticator code if two-factor authentication is enabled.')?.trim()
        return {
            password,
            totp_code: totpCode || null,
        }
    }, [])
    const {
        usedPct,
        storageStatus,
        storageStatusText,
        storageBreakdown,
        storageBreakdownTotal,
    } = useStorageSummary(quota, storageItems)
    const {
        ingestFiles,
        ingestFileArray,
        transfers: uploadTransfers,
        pauseTransfer,
        resumeTransfer,
        retryTransfer,
        removeTransfer,
        pauseAllTransfers,
        resumeAllTransfers,
    } = useFileUpload({
        publicKey,
        folderId: view === 'all' ? activeFolderId : null,
        online,
        setItems,
        setPendingIds,
        setError,
        refreshQuota,
    })
    const transferHistory = useMemo(
        () => [...downloadTransfers, ...uploadTransfers].sort((a, b) => b.updatedAt - a.updatedAt),
        [downloadTransfers, uploadTransfers],
    )

    function removeTransferHistoryEntry(id: string) {
        removeTransfer(id)
        removeDownloadTransfer(id)
    }
    const {
        fileCreateOpen,
        setFileCreateOpen,
        fileNameDraft,
        setFileNameDraft,
        fileSaving,
        resetFileCreateDraft,
        handleCreateFile,
    } = useCreateFile({
        ingestFileArray,
        handleFilePreview,
        setError,
    })
    const {
        noteItem,
        setNoteItem,
        noteSaving,
        handleSaveNote,
    } = useNoteActions({
        privateKey,
        setItems,
        setStorageItems,
        setError,
    })
    const {
        handleDelete,
        handleRestore,
        handleRestoreVersion,
        handlePermanentDelete,
        handleRename,
        handleShare,
        setFileSharing,
        expireFileLinks,
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
        requestReauthentication,
    })
    const {
        draggedCardId,
        dropTargetId,
        dropTargetPosition,
        handleCardDragStart,
        handleCardDragEnter,
        handleCardDragOver,
        handleCardDragLeave,
        handleCardDrop,
        handleCardDragEnd,
        moveCardByKeyboard,
    } = useManualCardOrdering({ sortKey, setSortKey, view, setItems })
    const {
        folderTrail,
        folderCreateOpen,
        setFolderCreateOpen,
        folderNameDraft,
        setFolderNameDraft,
        folderDescriptionDraft,
        setFolderDescriptionDraft,
        folderSaving,
        openFolder,
        openFolderRoot,
        openFolderAt,
        closeFolderCreate,
        handleCreateFolder,
        handleRenameFolder,
        handleShareFolder,
        setFolderSharing,
        toggleFolderFavourite,
    } = useFolderActions({
        publicKey,
        privateKey,
        setView,
        activeFolderId,
        setActiveFolderId,
        setFolders,
        folderFavouriteIds,
        setFolderFavouriteIds,
        setShareItem,
        setShareLoading,
        setError,
        setQuery,
    })

    useEffect(() => {
        saveActiveView(view)
    }, [view])

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

    async function moveSingleFileToFolder(fileId: string, targetFolderId: string | null) {
        const movedItem = items.find((item) => item.id === fileId)
        if (!fileId || movedItem?.folder_id === targetFolderId) return

        setError(null)
        setItems((current) =>
            targetFolderId === activeFolderId
                ? current.map((item) => (item.id === fileId ? { ...item, folder_id: targetFolderId } : item))
                : current.filter((item) => item.id !== fileId),
        )
        setStorageItems((current) => current.map((item) => (item.id === fileId ? { ...item, folder_id: targetFolderId } : item)))
        setFolders((current) =>
            current.map((item) => {
                if (item.id === movedItem?.folder_id) return { ...item, file_count: Math.max(0, item.file_count - 1) }
                if (item.id === targetFolderId) return { ...item, file_count: item.file_count + 1 }
                return item
            }),
        )

        try {
            await moveFile(fileId, targetFolderId)
        } catch (e) {
            if (movedItem) setItems((current) => (current.some((item) => item.id === fileId) ? current : [...current, movedItem]))
            setStorageItems((current) =>
                current.map((item) => (item.id === fileId ? { ...item, folder_id: movedItem?.folder_id ?? null } : item)),
            )
            setFolders((current) =>
                current.map((item) => {
                    if (item.id === movedItem?.folder_id) return { ...item, file_count: item.file_count + 1 }
                    if (item.id === targetFolderId) return { ...item, file_count: Math.max(0, item.file_count - 1) }
                    return item
                }),
            )
            setError(e instanceof Error ? e.message : 'Could not move that file.')
        }
    }

    async function dropFileOnFolder(folder: ApiFolder, event: DragEvent<HTMLElement>) {
        const fileId = event.dataTransfer.getData(FILE_CARD_DRAG_MIME)
        setFolderDropTargetId(null)
        handleCardDragEnd()

        await moveSingleFileToFolder(fileId, folder.id)
    }

    function dragFileOverFolder(folderId: string) {
        setFolderDropTargetId(folderId)
    }

    function dragFileLeaveFolder(folderId: string) {
        setFolderDropTargetId((current) => (current === folderId ? null : current))
    }

    function endFileCardDrag() {
        setFolderDropTargetId(null)
        setPathDropTargetId(null)
        handleCardDragEnd()
    }

    function dragFileOverPath(targetFolderId: string | null) {
        setPathDropTargetId(targetFolderId ?? '__root__')
    }

    function dragFileLeavePath(targetFolderId: string | null) {
        const targetKey = targetFolderId ?? '__root__'
        setPathDropTargetId((current) => (current === targetKey ? null : current))
    }

    async function dropFileOnPath(targetFolderId: string | null, event: DragEvent<HTMLButtonElement>) {
        const fileId = event.dataTransfer.getData(FILE_CARD_DRAG_MIME)
        setPathDropTargetId(null)
        handleCardDragEnd()

        await moveSingleFileToFolder(fileId, targetFolderId)
    }

    function openMoveFile(item: Item) {
        setError(null)
        setMoveItem(item)
    }

    async function moveFileFromModal(item: Item, targetFolderId: string | null) {
        if (moveSaving) return

        setMoveSaving(true)
        try {
            await moveSingleFileToFolder(item.id, targetFolderId)
            setMoveItem(null)
        } finally {
            setMoveSaving(false)
        }
    }

    async function createDashboardTag(name: string): Promise<Tag | null> {
        setError(null)
        try {
            const created = await createTag(name)
            setTags((current) => (current.some((tag) => tag.id === created.id) ? current : [...current, created]))
            return created
        } catch (e) {
            const existing = tags.find((tag) => tag.name.toLowerCase() === name.trim().toLowerCase())
            if (existing) return existing
            setError(e instanceof Error ? e.message : 'Could not create that tag.')
            return null
        }
    }

    async function addTagToFile(fileId: string, tagId: string) {
        const tag = tags.find((current) => current.id === tagId)
        if (!tag) return

        setError(null)
        updateFileTags(fileId, (current) =>
            current.some((fileTag) => fileTag.tag_id === tagId)
                ? current
                : [
                      ...current,
                      {
                          file_id: fileId,
                          tag_id: tag.id,
                          name: tag.name,
                          color: tag.color,
                          created_at: null,
                      },
                  ],
        )

        try {
            const saved = await addFileTag(fileId, tagId)
            updateFileTags(fileId, (current) => current.map((fileTag) => (fileTag.tag_id === tagId ? saved : fileTag)))
        } catch (e) {
            updateFileTags(fileId, (current) => current.filter((fileTag) => fileTag.tag_id !== tagId))
            setError(e instanceof Error ? e.message : 'Could not add that tag.')
        }
    }

    async function removeTagFromFile(fileId: string, tagId: string) {
        const previousTags = fileTagsByFileId.get(fileId) ?? []
        setError(null)
        updateFileTags(fileId, (current) => current.filter((fileTag) => fileTag.tag_id !== tagId))

        try {
            await removeFileTag(fileId, tagId)
        } catch (e) {
            updateFileTags(fileId, () => previousTags)
            setError(e instanceof Error ? e.message : 'Could not remove that tag.')
        }
    }

    async function remindAboutFile(item: Item) {
        const reminderDate = new Date()
        reminderDate.setDate(reminderDate.getDate() + 1)
        const date = [
            reminderDate.getFullYear(),
            String(reminderDate.getMonth() + 1).padStart(2, '0'),
            String(reminderDate.getDate()).padStart(2, '0'),
        ].join('-')

        setError(null)
        try {
            await createCalendarEntry({
                kind: 'deadline',
                date,
                time: '09:00',
                title: `Review ${item.filename}`,
                note: `Reminder for ${item.filename}`,
                reminder: '1d',
                file_id: item.id,
            })
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create that reminder.')
        }
    }

    const clearSelection = useCallback(() => {
        setSelectedFileIds(new Set())
        setSelectedFolderIds(new Set())
    }, [])

    function selectNavView(key: ViewKey) {
        clearSelection()
        if (key === 'all') {
            openFolderRoot()
        }
        setView(key)
    }

    const openFolderWithSelectionReset = useCallback((folder: Parameters<typeof openFolder>[0]) => {
        clearSelection()
        openFolder(folder)
    }, [clearSelection, openFolder])

    function openFolderRootWithSelectionReset() {
        clearSelection()
        openFolderRoot()
    }

    function openFolderAtWithSelectionReset(folder: Parameters<typeof openFolderAt>[0], index: number) {
        clearSelection()
        openFolderAt(folder, index)
    }

    async function handleDeleteFolder(id: string) {
        setError(null)
        try {
            await deleteFolder(id)
            setFolders((current) => current.filter((folder) => folder.id !== id))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not move that folder to trash.')
        }
    }

    async function handleRestoreFolder(id: string) {
        setError(null)
        try {
            await restoreFolder(id)
            setFolders((current) => current.filter((folder) => folder.id !== id))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not restore that folder.')
        }
    }

    async function handlePermanentDeleteFolder(id: string) {
        if (!window.confirm('Permanently delete this folder and its contents? This cannot be undone.')) return
        const reauth = requestReauthentication('permanently delete this folder')
        if (!reauth) return
        setError(null)
        try {
            await permanentlyDeleteFolder(id, reauth)
            setFolders((current) => current.filter((folder) => folder.id !== id))
            await refreshQuota()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not permanently delete that folder.')
        }
    }

    function toggleFileSelected(id: string) {
        setSelectedFileIds((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function toggleFolderSelected(id: string) {
        setSelectedFolderIds((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const toggleAllVisibleSelected = useCallback(() => {
        if (allVisibleSelected) {
            clearSelection()
            return
        }

        setSelectedFileIds(new Set(view === 'all' || view === 'favourites' || view === 'trash' ? visibleFileIds : []))
        setSelectedFolderIds(new Set(view === 'all' || view === 'favourites' || view === 'trash' ? visibleFolderIds : []))
    }, [allVisibleSelected, clearSelection, view, visibleFileIds, visibleFolderIds])

    const bulkDelete = useCallback(async () => {
        const ids = Array.from(selectedFileIds)
        const folderIds = Array.from(selectedFolderIds)
        if (ids.length === 0 && folderIds.length === 0) return
        await Promise.all([...ids.map((id) => handleDelete(id)), ...folderIds.map((id) => handleDeleteFolder(id))])
        clearSelection()
    }, [clearSelection, handleDelete, handleDeleteFolder, selectedFileIds, selectedFolderIds])

    async function bulkRestore() {
        const ids = Array.from(selectedFileIds)
        const folderIds = Array.from(selectedFolderIds)
        if (ids.length === 0 && folderIds.length === 0) return
        await Promise.all([...ids.map((id) => handleRestore(id)), ...folderIds.map((id) => handleRestoreFolder(id))])
        clearSelection()
    }

    const bulkPermanentDelete = useCallback(async () => {
        const ids = Array.from(selectedFileIds)
        const folderIds = Array.from(selectedFolderIds)
        if (ids.length === 0 && folderIds.length === 0) return
        const total = ids.length + folderIds.length
        const confirmed = window.confirm(`Permanently delete ${total} selected item${total === 1 ? '' : 's'}? This cannot be undone.`)
        if (!confirmed) return
        const reauth = requestReauthentication(`permanently delete ${total} selected item${total === 1 ? '' : 's'}`)
        if (!reauth) return
        const previousItems = items
        const previousStorageItems = storageItems
        const previousFavouriteIds = new Set(favouriteIds)
        const previousFolders = folders

        setItems((current) => current.filter((item) => !selectedFileIds.has(item.id)))
        setStorageItems((current) => current.filter((item) => !selectedFileIds.has(item.id)))
        setFavouriteIds((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
        })
        setFolders((current) => current.filter((folder) => !selectedFolderIds.has(folder.id)))

        try {
            await Promise.all([...ids.map((id) => permanentlyDeleteFile(id, reauth)), ...folderIds.map((id) => permanentlyDeleteFolder(id, reauth))])
            await refreshQuota()
            clearSelection()
        } catch (e) {
            setItems(previousItems)
            setStorageItems(previousStorageItems)
            setFavouriteIds(previousFavouriteIds)
            setFolders(previousFolders)
            setError(e instanceof Error ? e.message : 'Could not permanently delete the selected files.')
        }
    }, [
        clearSelection,
        favouriteIds,
        items,
        refreshQuota,
        requestReauthentication,
        selectedFileIds,
        selectedFolderIds,
        folders,
        setError,
        setFavouriteIds,
        setItems,
        setStorageItems,
        storageItems,
    ])

    async function bulkDownload() {
        const selectedFiles = renderedItems.filter((item) => selectedFileIds.has(item.id))
        const selectedFolders = visibleFolders.filter((folder) => selectedFolderIds.has(folder.id))
        for (const item of selectedFiles) {
            await handleDownload(item)
        }
        for (const folder of selectedFolders) {
            await downloadFolder(folder)
        }
    }

    async function bulkMove(targetFolderId: string | null) {
        const fileIds = Array.from(selectedFileIds)
        const folderIds = Array.from(selectedFolderIds)
        if (fileIds.length === 0 && folderIds.length === 0) return

        setError(null)
        try {
            await Promise.all([
                ...fileIds.map((id) => moveFile(id, targetFolderId)),
                ...folderIds.map((id) => moveFolder(id, targetFolderId)),
            ])

            setItems((current) =>
                targetFolderId === activeFolderId ? current : current.filter((item) => !selectedFileIds.has(item.id)),
            )
            setStorageItems((current) =>
                current.map((item) => (selectedFileIds.has(item.id) ? { ...item, folder_id: targetFolderId } : item)),
            )
            setFolders((current) =>
                targetFolderId === activeFolderId
                    ? current
                    : current.filter((folder) => !selectedFolderIds.has(folder.id)),
            )
            clearSelection()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not move the selected items.')
        }
    }

    useEffect(() => {
        const modalOpen = Boolean(filePreview || settingsOpen || fileCreateOpen || folderCreateOpen || noteItem || moveItem || shareItem)
        const bulkActionsAvailable = view === 'all' || view === 'favourites' || view === 'trash'

        function openSelectedItem() {
            if (selectedFileIds.size + selectedFolderIds.size !== 1) return false

            const selectedFolderId = Array.from(selectedFolderIds)[0]
            if (selectedFolderId) {
                const folder = visibleFolders.find((item) => item.id === selectedFolderId)
                if (!folder) return false
                openFolderWithSelectionReset(folder)
                return true
            }

            const selectedFileId = Array.from(selectedFileIds)[0]
            const item = renderedItems.find((current) => current.id === selectedFileId)
            if (!item || pendingIds.has(item.id) || view === 'trash') return false
            void handleFilePreview(item)
            return true
        }

        function handleDashboardKeyDown(event: KeyboardEvent) {
            if (event.defaultPrevented || isTextEditingTarget(event.target)) return

            if (event.key === '/' && !modalOpen) {
                event.preventDefault()
                searchInputRef.current?.focus()
                return
            }

            if (modalOpen) return

            const shortcutKey = event.key.toLowerCase()
            const usesCommandModifier = event.ctrlKey || event.metaKey

            if (event.key === 'Escape') {
                if (selectedCount > 0) {
                    event.preventDefault()
                    clearSelection()
                    return
                }
                if (query) {
                    event.preventDefault()
                    setQuery('')
                }
                return
            }

            if (usesCommandModifier && shortcutKey === 'a' && bulkActionsAvailable) {
                event.preventDefault()
                toggleAllVisibleSelected()
                return
            }

            if (!usesCommandModifier && !event.altKey && shortcutKey === 'n' && view === 'all') {
                event.preventDefault()
                if (event.shiftKey) setFolderCreateOpen(true)
                else setFileCreateOpen(true)
                return
            }

            if (event.key === 'Enter' && openSelectedItem()) {
                event.preventDefault()
                return
            }

            if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCount > 0 && bulkActionsAvailable) {
                event.preventDefault()
                if (view === 'trash') void bulkPermanentDelete()
                else void bulkDelete()
            }
        }

        window.addEventListener('keydown', handleDashboardKeyDown)
        return () => window.removeEventListener('keydown', handleDashboardKeyDown)
    }, [
        bulkDelete,
        bulkPermanentDelete,
        clearSelection,
        fileCreateOpen,
        filePreview,
        folderCreateOpen,
        handleFilePreview,
        moveItem,
        noteItem,
        openFolderWithSelectionReset,
        pendingIds,
        query,
        renderedItems,
        searchInputRef,
        selectedCount,
        selectedFileIds,
        selectedFolderIds,
        settingsOpen,
        setFileCreateOpen,
        setFolderCreateOpen,
        shareItem,
        toggleAllVisibleSelected,
        view,
        visibleFolders,
    ])

    async function blockPublicFileLink(file: ApiFile) {
        const previousItems = items
        const previousStorageItems = storageItems
        const nextFile = { ...file, is_public: false, share_token: null }

        setItems((current) => current.map((item) => (item.id === file.id ? { ...item, is_public: false, share_token: null } : item)))
        setStorageItems((current) => current.map((item) => (item.id === file.id ? nextFile : item)))

        try {
            const updated = await shareFile(file.id, false)
            handleFileUpdated(updated)
        } catch (e) {
            setItems(previousItems)
            setStorageItems(previousStorageItems)
            throw e
        }
    }

    async function blockPublicFolderLink(folder: ApiFolder) {
        const previousFolders = folders
        setFolders((current) => current.map((item) => (item.id === folder.id ? { ...item, is_public: false, share_token: null } : item)))

        try {
            const updated = await shareFolder(folder.id, false)
            setFolders((current) => current.map((item) => (item.id === updated.id ? { ...updated, name: item.name, description: item.description } : item)))
        } catch (e) {
            setFolders(previousFolders)
            throw e
        }
    }

    async function restoreFolderToPoint(folder: ApiFolder, restoreAt: string): Promise<FolderPointRestoreResult> {
        if (!privateKey) throw new Error('Vault key is not available.')

        const result = await restoreFolderPoint(folder.id, restoreAt)
        const [quotaData, files, trashedFiles, foldersData] = await Promise.all([
            getStorageQuota(),
            listFiles(),
            listTrash(),
            listFolders(),
        ])
        const fileData = [...files, ...trashedFiles.filter((file) => !files.some((current) => current.id === file.id))]
        const [visibleFileData, visibleFolderData] = await Promise.all([
            decryptFilesMetadata(fileData, privateKey),
            decryptFoldersMetadata(foldersData, privateKey),
        ])
        setQuota(quotaData)
        setStorageItems(visibleFileData)
        setFolders(visibleFolderData)
        setFavouriteIds(new Set(fileData.filter((file) => file.is_favourite).map((file) => file.id)))
        setFolderFavouriteIds(new Set(foldersData.filter((item) => item.is_favourite).map((item) => item.id)))
        return result
    }

    if (sessionLoading || !currentUser || !privateKey) {
        return (
            <div className="dashboard-loading" role="status" aria-live="polite">
                <span className="spinner" />
                <div>
                    <p className="dashboard-loading__title">Unlocking dashboard</p>
                    <p className="dashboard-loading__body">Preparing your encrypted vault...</p>
                </div>
            </div>
        )
    }

    return (
        <div
            className={`shell ${sidebarHidden ? 'is-sidebar-hidden' : ''} ${sidebarCompact ? 'is-sidebar-compact' : ''} ${sidebarStorageCompact ? 'is-sidebar-storage-compact' : ''}`}
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
                onResizeSidebarWithKeyboard={resizeSidebarWithKeyboard}
                onSelectNavView={selectNavView}
                onNavDragStart={handleNavDragStart}
                onNavDragEnter={handleNavDragEnter}
                onNavDragLeave={handleNavDragLeave}
                onNavDrop={handleNavDrop}
                onNavDragEnd={handleNavDragEnd}
                onMoveNavItem={moveNavItem}
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
                    tags={tags}
                    ownerOptions={ownerOptions}
                    folderOptions={folderOptions}
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
                    onClearFileTypes={clearFileTypes}
                    onToggleFileType={toggleFileTypeFilter}
                    onVisibilityChange={updateVisibilityFilter}
                    onOwnerChange={updateOwnerFilter}
                    onFolderChange={updateFolderFilter}
                    onTagChange={updateTagFilter}
                    onSizeInputChange={updateSizeFilter}
                    onSizeSliderChange={updateSizeSlider}
                    onExcludedExtensionsChange={updateExcludedExtensions}
                    onModifiedDateChange={updateModifiedDateFilter}
                    onNoteQueryChange={updateNoteQuery}
                    onClearFilters={clearFileFilters}
                    onLayoutModeChange={changeLayoutMode}
                    onOpenFileCreate={() => setFileCreateOpen(true)}
                    onOpenFolderCreate={() => setFolderCreateOpen(true)}
                    onUploadChange={onUploadChange}
                    uploadTransfers={uploadTransfers}
                    transferHistory={transferHistory}
                    onPauseTransfer={pauseTransfer}
                    onResumeTransfer={resumeTransfer}
                    onRetryTransfer={retryTransfer}
                    onRemoveTransfer={removeTransferHistoryEntry}
                    onPauseAllTransfers={pauseAllTransfers}
                    onResumeAllTransfers={resumeAllTransfers}
                    folderTrail={folderTrail}
                    onOpenRoot={openFolderRootWithSelectionReset}
                    onOpenFolderAt={openFolderAtWithSelectionReset}
                    error={error}
                    online={online}
                    offlineSnapshotSavedAt={offlineSnapshot?.savedAt ?? null}
                    loading={loading}
                    visibleItems={visibleItems}
                    renderedItems={renderedItems}
                    visibleFolders={visibleFolders}
                    storageItems={storageItems}
                    exitingIds={animatedFiles.exitingIds}
                    pendingIds={pendingIds}
                    favouriteIds={favouriteIds}
                    folderFavouriteIds={folderFavouriteIds}
                    fileTagsByFileId={fileTagsByFileId}
                    currentUser={currentUser}
                    groups={groups}
                    incomingGroupInvites={incomingInvites}
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
                    onAcceptInvite={acceptGroupInvite}
                    onDeclineInvite={declineGroupInvite}
                    onUpdateMember={updateMemberRole}
                    onRemoveMember={removeGroupMember}
                    onLeaveGroup={leaveGroup}
                    onUpdateGroup={updateGroup}
                    onDeleteGroup={deleteGroup}
                    draggedCardId={draggedCardId}
                    dropTargetId={dropTargetId}
                    dropTargetPosition={dropTargetPosition}
                    folderDropTargetId={folderDropTargetId}
                    pathDropTargetId={pathDropTargetId}
                    selectedFileIds={selectedFileIds}
                    selectedFolderIds={selectedFolderIds}
                    selectedCount={selectedCount}
                    allVisibleSelected={allVisibleSelected}
                    moveTargets={moveTargets}
                    onOpenFolder={openFolderWithSelectionReset}
                    onShareFolder={handleShareFolder}
                    onDownloadFolder={downloadFolder}
                    onDeleteFolder={handleDeleteFolder}
                    onRestoreFolder={handleRestoreFolder}
                    onPermanentDeleteFolder={handlePermanentDeleteFolder}
                    onRenameFolder={handleRenameFolder}
                    onToggleFolderFavourite={toggleFolderFavourite}
                    onDelete={handleDelete}
                    onRestore={handleRestore}
                    onRestoreVersion={handleRestoreVersion}
                    onPermanentDelete={handlePermanentDelete}
                    onDownload={handleDownload}
                    onPreview={handleFilePreview}
                    onRename={handleRename}
                    onShare={handleShare}
                    onNote={setNoteItem}
                    onRemind={remindAboutFile}
                    onMoveFile={openMoveFile}
                    onToggleFavourite={toggleFavourite}
                    onCreateTag={createDashboardTag}
                    onAddTagToFile={addTagToFile}
                    onRemoveTagFromFile={removeTagFromFile}
                    onDragStartCard={handleCardDragStart}
                    onDragEnterCard={handleCardDragEnter}
                    onDragOverCard={handleCardDragOver}
                    onDragLeaveCard={handleCardDragLeave}
                    onDropCard={handleCardDrop}
                    onDragEndCard={endFileCardDrag}
                    onMoveCardByKeyboard={moveCardByKeyboard}
                    onFileDragEnterFolder={dragFileOverFolder}
                    onFileDragLeaveFolder={dragFileLeaveFolder}
                    onDropFileOnFolder={(folder, event) => void dropFileOnFolder(folder, event)}
                    onFileDragEnterPath={dragFileOverPath}
                    onFileDragLeavePath={dragFileLeavePath}
                    onDropFileOnPath={(targetFolderId, event) => void dropFileOnPath(targetFolderId, event)}
                    onToggleFileSelected={toggleFileSelected}
                    onToggleFolderSelected={toggleFolderSelected}
                    onToggleAllVisibleSelected={toggleAllVisibleSelected}
                    onClearSelection={clearSelection}
                    onBulkDelete={bulkDelete}
                    onBulkRestore={bulkRestore}
                    onBulkPermanentDelete={bulkPermanentDelete}
                    onBulkDownload={bulkDownload}
                    onBulkMove={bulkMove}
                    onBlockFileLink={blockPublicFileLink}
                    onBlockFolderLink={blockPublicFolderLink}
                    onRestoreFolderPoint={restoreFolderToPoint}
                    onSignOutCurrentSession={signOut}
                />
            </div>
            <DashboardModals
                filePreview={filePreview}
                onCloseFilePreview={closeFilePreview}
                onDownload={handleDownload}
                onSaveTextFile={handleSaveTextFile}
                onReloadFilePreview={handleFilePreview}
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
                onCloseFolderCreate={closeFolderCreate}
                noteItem={noteItem}
                noteSaving={noteSaving}
                onCloseNote={() => setNoteItem(null)}
                onSaveNote={handleSaveNote}
                moveItem={moveItem}
                moveSaving={moveSaving}
                onCloseMove={() => setMoveItem(null)}
                onMoveFile={moveFileFromModal}
                shareItem={shareItem}
                shareLoading={shareLoading}
                privateKey={privateKey}
                groups={groups}
                onCloseShare={() => setShareItem(null)}
                onSetFileSharing={setFileSharing}
                onSetFolderSharing={setFolderSharing}
                onExpireFileLinks={expireFileLinks}
            />
            <DashboardTour userId={currentUser.id} />
        </div>
    )
}

export default Dashboard

