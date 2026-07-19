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
import type { ShareableItem, ViewKey } from './dashboard/types'
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
import { useLayoutModeSwitch } from './dashboard/hooks/useLayoutModeSwitch'
import { useManualCardOrdering } from './dashboard/hooks/useManualCardOrdering'
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
    } = useNavOrdering()
    const {
        sidebarWidth,
        sidebarHidden,
        sidebarCompact,
        setSidebarHidden,
        startSidebarResize,
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
    const {
        usedPct,
        storageStatus,
        storageStatusText,
        storageBreakdown,
        storageBreakdownTotal,
    } = useStorageSummary(quota, storageItems)
    const { ingestFiles, ingestFileArray } = useFileUpload({
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
        openFolderParent,
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

    function selectNavView(key: ViewKey) {
        if (key === 'all') {
            openFolderRoot()
        }
        setView(key)
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
                    folderTrail={folderTrail}
                    onOpenRoot={openFolderRoot}
                    onOpenFolderAt={openFolderAt}
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
                    folderFavouriteIds={folderFavouriteIds}
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
                    onToggleFolderFavourite={toggleFolderFavourite}
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
                onCloseFolderCreate={closeFolderCreate}
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

