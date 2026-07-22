import React, {
    useEffect,
    useMemo,
    useState,
    type ChangeEvent,
    type DragEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'
import '../css/dashboard.css'
import type { Item, ShareableItem, ViewKey } from './dashboard/types'
import { moveFile, moveFolder, permanentlyDeleteFile, type ApiFolder } from '../api/files'
import { DashboardContent } from './dashboard/components/DashboardContent'
import { DashboardModals } from './dashboard/components/DashboardModals'
import { DashboardSidebar } from './dashboard/components/DashboardSidebar'
import { DashboardTopbar } from './dashboard/components/DashboardTopbar'
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
        storageItems,
        setStorageItems,
        favouriteIds,
        setFavouriteIds,
        folderFavouriteIds,
        setFolderFavouriteIds,
        refreshQuota,
        handleFileUpdated,
    } = useDashboardData({ view, activeFolderId, privateKey })

    const { filePreview, closeFilePreview, handleDownload, handleFilePreview, handleSaveTextFile } = useFilePreview(
        privateKey,
        publicKey,
        setError,
        handleFileUpdated,
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
        if (view !== 'all' && view !== 'favourites') return []
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
        updateSizeFilter,
        updateSizeSlider,
        updateExcludedExtensions,
        updateModifiedDateFilter,
        clearFileFilters,
    } = useFileFilterControls(items)
    const { visibleItems, renderedItems, animatedFiles } = useAnimatedItems({
        items: sortedItems,
        view,
        favouriteIds,
        normalizedQuery,
    })
    const visibleFileIds = useMemo(() => renderedItems.filter((item) => !pendingIds.has(item.id)).map((item) => item.id), [pendingIds, renderedItems])
    const visibleFolderIds = useMemo(() => visibleFolders.map((folder) => folder.id), [visibleFolders])
    const selectedCount = selectedFileIds.size + selectedFolderIds.size
    const allVisibleSelected = useMemo(() => {
        const selectableFileIds = view === 'all' || view === 'favourites' || view === 'trash' ? visibleFileIds : []
        const selectableFolderIds = view === 'all' || view === 'favourites' ? visibleFolderIds : []
        const total = selectableFileIds.length + selectableFolderIds.length
        if (total === 0) return false
        return selectableFileIds.every((id) => selectedFileIds.has(id)) && selectableFolderIds.every((id) => selectedFolderIds.has(id))
    }, [selectedFileIds, selectedFolderIds, view, visibleFileIds, visibleFolderIds])
    const moveTargets = useMemo(
        () => visibleFolders.filter((folder) => !selectedFolderIds.has(folder.id)),
        [selectedFolderIds, visibleFolders],
    )
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
        setItems,
        setPendingIds,
        setError,
        refreshQuota,
    })
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
    const {
        draggedCardId,
        dropTargetId,
        handleCardDragStart,
        handleCardDragEnter,
        handleCardDragLeave,
        handleCardDrop,
        handleCardDragEnd,
        moveCardByKeyboard,
    } = useManualCardOrdering({ sortKey, view, setItems })
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

    function selectNavView(key: ViewKey) {
        clearSelection()
        if (key === 'all') {
            openFolderRoot()
        }
        setView(key)
    }

    function openFolderWithSelectionReset(folder: Parameters<typeof openFolder>[0]) {
        clearSelection()
        openFolder(folder)
    }

    function openFolderRootWithSelectionReset() {
        clearSelection()
        openFolderRoot()
    }

    function openFolderAtWithSelectionReset(folder: Parameters<typeof openFolderAt>[0], index: number) {
        clearSelection()
        openFolderAt(folder, index)
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

    function clearSelection() {
        setSelectedFileIds(new Set())
        setSelectedFolderIds(new Set())
    }

    function toggleAllVisibleSelected() {
        if (allVisibleSelected) {
            clearSelection()
            return
        }

        setSelectedFileIds(new Set(view === 'all' || view === 'favourites' || view === 'trash' ? visibleFileIds : []))
        setSelectedFolderIds(new Set(view === 'all' || view === 'favourites' ? visibleFolderIds : []))
    }

    async function bulkDelete() {
        const ids = Array.from(selectedFileIds)
        if (ids.length === 0) return
        await Promise.all(ids.map((id) => handleDelete(id)))
        clearSelection()
    }

    async function bulkRestore() {
        const ids = Array.from(selectedFileIds)
        if (ids.length === 0) return
        await Promise.all(ids.map((id) => handleRestore(id)))
        clearSelection()
    }

    async function bulkPermanentDelete() {
        const ids = Array.from(selectedFileIds)
        if (ids.length === 0) return
        const confirmed = window.confirm(`Permanently delete ${ids.length} selected file${ids.length === 1 ? '' : 's'}? This cannot be undone.`)
        if (!confirmed) return
        const previousItems = items
        const previousStorageItems = storageItems
        const previousFavouriteIds = new Set(favouriteIds)

        setItems((current) => current.filter((item) => !selectedFileIds.has(item.id)))
        setStorageItems((current) => current.filter((item) => !selectedFileIds.has(item.id)))
        setFavouriteIds((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
        })

        try {
            await Promise.all(ids.map((id) => permanentlyDeleteFile(id)))
            await refreshQuota()
            clearSelection()
        } catch (e) {
            setItems(previousItems)
            setStorageItems(previousStorageItems)
            setFavouriteIds(previousFavouriteIds)
            setError(e instanceof Error ? e.message : 'Could not permanently delete the selected files.')
        }
    }

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
                    onSizeInputChange={updateSizeFilter}
                    onSizeSliderChange={updateSizeSlider}
                    onExcludedExtensionsChange={updateExcludedExtensions}
                    onModifiedDateChange={updateModifiedDateFilter}
                    onClearFilters={clearFileFilters}
                    onLayoutModeChange={changeLayoutMode}
                    onOpenFileCreate={() => setFileCreateOpen(true)}
                    onOpenFolderCreate={() => setFolderCreateOpen(true)}
                    onUploadChange={onUploadChange}
                    uploadTransfers={uploadTransfers}
                    onPauseTransfer={pauseTransfer}
                    onResumeTransfer={resumeTransfer}
                    onRetryTransfer={retryTransfer}
                    onRemoveTransfer={removeTransfer}
                    onPauseAllTransfers={pauseAllTransfers}
                    onResumeAllTransfers={resumeAllTransfers}
                    folderTrail={folderTrail}
                    onOpenRoot={openFolderRootWithSelectionReset}
                    onOpenFolderAt={openFolderAtWithSelectionReset}
                    error={error}
                    loading={loading}
                    visibleItems={visibleItems}
                    renderedItems={renderedItems}
                    visibleFolders={visibleFolders}
                    storageItems={storageItems}
                    exitingIds={animatedFiles.exitingIds}
                    pendingIds={pendingIds}
                    favouriteIds={favouriteIds}
                    folderFavouriteIds={folderFavouriteIds}
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
                    onMoveFile={openMoveFile}
                    onToggleFavourite={toggleFavourite}
                    onDragStartCard={handleCardDragStart}
                    onDragEnterCard={handleCardDragEnter}
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
            />
        </div>
    )
}

export default Dashboard

