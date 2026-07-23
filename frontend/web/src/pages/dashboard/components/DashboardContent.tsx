import { useMemo, useState, type ChangeEvent, type DragEvent, type RefObject } from 'react'
import type { CurrentUserResponse } from '../../../api/users'
import type { ApiFile, ApiFolder } from '../../../api/files'
import type { FileTag, Tag } from '../../../api/tags'
import { CalendarPanel } from './CalendarPanel'
import { DashboardFileGrid } from './DashboardFileGrid'
import { DashboardToolbar } from './DashboardToolbar'
import { EmptyPane } from './EmptyPane'
import { FolderBreadcrumbs } from './FolderBreadcrumbs'
import { GroupsPanel } from './GroupsPanel'
import { TransferQueuePanel } from './TransferQueuePanel'
import type { FileCardDropPosition } from '../hooks/useManualCardOrdering'
import type { UploadTransfer } from '../hooks/useFileUpload'
import type {
    FileFilters,
    FileSortKey,
    FileTypeFilterKey,
    FileVisibilityFilterKey,
    Group,
    GroupIncomingInvite,
    Item,
    LayoutMode,
    ViewKey,
} from '../types'

type DashboardContentProps = {
    view: ViewKey
    dragActive: boolean
    isFileDrag: (event: DragEvent<HTMLDivElement>) => boolean
    onDragActiveChange: (active: boolean) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
    sortMenuRef: RefObject<HTMLDivElement | null>
    filterMenuRef: RefObject<HTMLDivElement | null>
    sortMenuOpen: boolean
    sortMenuClosing: boolean
    filterMenuOpen: boolean
    filterMenuClosing: boolean
    sortKey: FileSortKey
    layoutMode: LayoutMode
    layoutSwitchTarget: LayoutMode | null
    filterSummary: string
    query: string
    fileFilters: FileFilters
    tags: Tag[]
    hasActiveFilter: boolean
    sizeSliderMax: number
    sizeSliderMinValue: number
    sizeSliderMaxValue: number
    sizeSliderMinPct: number
    sizeSliderMaxPct: number
    onToggleSortMenu: () => void
    onCloseSortMenu: () => void
    onSortKeyChange: (key: FileSortKey) => void
    onToggleFilterMenu: () => void
    onCloseFilterMenu: () => void
    onQueryChange: (query: string) => void
    onClearFileTypes: () => void
    onToggleFileType: (type: FileTypeFilterKey) => void
    onVisibilityChange: (visibility: FileVisibilityFilterKey) => void
    onTagChange: (tagId: string) => void
    onSizeInputChange: (field: 'minSizeMb' | 'maxSizeMb', value: string) => void
    onSizeSliderChange: (field: 'minSizeMb' | 'maxSizeMb', value: string) => void
    onExcludedExtensionsChange: (value: string) => void
    onModifiedDateChange: (field: 'modifiedFrom' | 'modifiedTo', value: string) => void
    onClearFilters: () => void
    onLayoutModeChange: (mode: LayoutMode) => void
    onOpenFileCreate: () => void
    onOpenFolderCreate: () => void
    onUploadChange: (event: ChangeEvent<HTMLInputElement>) => void
    uploadTransfers: UploadTransfer[]
    onPauseTransfer: (id: string) => void
    onResumeTransfer: (id: string) => void
    onRetryTransfer: (id: string) => void
    onRemoveTransfer: (id: string) => void
    onPauseAllTransfers: () => void
    onResumeAllTransfers: () => void
    folderTrail: ApiFolder[]
    onOpenRoot: () => void
    onOpenFolderAt: (folder: ApiFolder, index: number) => void
    error: string | null
    loading: boolean
    visibleItems: Item[]
    renderedItems: Item[]
    visibleFolders: ApiFolder[]
    storageItems: ApiFile[]
    exitingIds: Set<string>
    pendingIds: Set<string>
    favouriteIds: Set<string>
    folderFavouriteIds: Set<string>
    fileTagsByFileId: Map<string, FileTag[]>
    currentUser: CurrentUserResponse | null
    groups: Group[]
    incomingGroupInvites: GroupIncomingInvite[]
    groupError: string | null
    activeGroupId: string | null
    groupCreateOpen: boolean
    groupInviteOpen: boolean
    onCreateGroup: (name: string, defaultRole: Group['defaultRole']) => void
    onOpenGroupCreate: () => void
    onCloseGroupCreate: () => void
    onOpenGroup: (groupId: string) => void
    onBackToGroups: () => void
    onOpenGroupInvite: () => void
    onCloseGroupInvite: () => void
    onInvite: (groupId: string, email: string, role: Group['defaultRole']) => void
    onRemoveInvite: (groupId: string, inviteId: string) => void
    onAcceptInvite: (inviteId: string) => void
    onDeclineInvite: (inviteId: string) => void
    onUpdateMember: (groupId: string, memberUserId: string, role: Group['defaultRole']) => void
    onRemoveMember: (groupId: string, memberUserId: string) => void
    onLeaveGroup: (groupId: string) => void
    onUpdateGroup: (groupId: string, name: string, defaultRole: Group['defaultRole']) => void
    onDeleteGroup: (groupId: string) => void
    draggedCardId: string | null
    dropTargetId: string | null
    dropTargetPosition: FileCardDropPosition
    folderDropTargetId: string | null
    pathDropTargetId: string | null
    selectedFileIds: Set<string>
    selectedFolderIds: Set<string>
    selectedCount: number
    allVisibleSelected: boolean
    moveTargets: ApiFolder[]
    onOpenFolder: (folder: ApiFolder) => void
    onShareFolder: (folder: ApiFolder) => void
    onDownloadFolder: (folder: ApiFolder) => void | Promise<void>
    onRenameFolder: (folder: ApiFolder, name: string, description: string | null) => Promise<void>
    onToggleFolderFavourite: (id: string) => void | Promise<void>
    onDelete: (id: string) => void | Promise<void>
    onRestore: (id: string) => void | Promise<void>
    onRestoreVersion: (item: Item, versionId: string) => unknown | Promise<unknown>
    onPermanentDelete: (id: string) => void | Promise<void>
    onDownload: (item: Item) => void | Promise<void>
    onPreview: (item: Item) => void | Promise<void>
    onRename: (item: Item, filename: string) => Promise<void>
    onShare: (item: Item) => void | Promise<void>
    onNote: (item: Item) => void
    onMoveFile: (item: Item) => void | Promise<void>
    onToggleFavourite: (id: string) => void | Promise<void>
    onCreateTag: (name: string) => Promise<Tag | null>
    onAddTagToFile: (fileId: string, tagId: string) => void | Promise<void>
    onRemoveTagFromFile: (fileId: string, tagId: string) => void | Promise<void>
    onDragStartCard: (id: string, event: DragEvent<HTMLElement>) => void
    onDragEnterCard: (id: string) => void
    onDragOverCard: (id: string, event: DragEvent<HTMLElement>) => void
    onDragLeaveCard: (id: string) => void
    onDropCard: (id: string, event: DragEvent<HTMLElement>) => void
    onDragEndCard: () => void
    onMoveCardByKeyboard: (id: string, offset: number) => void
    onFileDragEnterFolder: (folderId: string) => void
    onFileDragLeaveFolder: (folderId: string) => void
    onDropFileOnFolder: (folder: ApiFolder, event: DragEvent<HTMLElement>) => void
    onFileDragEnterPath: (targetFolderId: string | null) => void
    onFileDragLeavePath: (targetFolderId: string | null) => void
    onDropFileOnPath: (targetFolderId: string | null, event: DragEvent<HTMLButtonElement>) => void
    onToggleFileSelected: (id: string) => void
    onToggleFolderSelected: (id: string) => void
    onToggleAllVisibleSelected: () => void
    onClearSelection: () => void
    onBulkDelete: () => void | Promise<void>
    onBulkRestore: () => void | Promise<void>
    onBulkPermanentDelete: () => void | Promise<void>
    onBulkDownload: () => void | Promise<void>
    onBulkMove: (targetFolderId: string | null) => void | Promise<void>
}

function titleForView(view: ViewKey) {
    const titles: Record<ViewKey, string> = {
        all: 'All files',
        favourites: 'Favourites',
        shared: 'Shared with me',
        groups: 'Groups',
        calendar: 'Calendar',
        trash: 'Trash',
    }
    return titles[view]
}

export function DashboardContent({
    view,
    dragActive,
    isFileDrag,
    onDragActiveChange,
    onDrop,
    sortMenuRef,
    filterMenuRef,
    sortMenuOpen,
    sortMenuClosing,
    filterMenuOpen,
    filterMenuClosing,
    sortKey,
    layoutMode,
    layoutSwitchTarget,
    filterSummary,
    query,
    fileFilters,
    tags,
    hasActiveFilter,
    sizeSliderMax,
    sizeSliderMinValue,
    sizeSliderMaxValue,
    sizeSliderMinPct,
    sizeSliderMaxPct,
    onToggleSortMenu,
    onCloseSortMenu,
    onSortKeyChange,
    onToggleFilterMenu,
    onCloseFilterMenu,
    onQueryChange,
    onClearFileTypes,
    onToggleFileType,
    onVisibilityChange,
    onTagChange,
    onSizeInputChange,
    onSizeSliderChange,
    onExcludedExtensionsChange,
    onModifiedDateChange,
    onClearFilters,
    onLayoutModeChange,
    onOpenFileCreate,
    onOpenFolderCreate,
    onUploadChange,
    uploadTransfers,
    onPauseTransfer,
    onResumeTransfer,
    onRetryTransfer,
    onRemoveTransfer,
    onPauseAllTransfers,
    onResumeAllTransfers,
    folderTrail,
    onOpenRoot,
    onOpenFolderAt,
    error,
    loading,
    visibleItems,
    renderedItems,
    visibleFolders,
    storageItems,
    exitingIds,
    pendingIds,
    favouriteIds,
    folderFavouriteIds,
    fileTagsByFileId,
    currentUser,
    groups,
    incomingGroupInvites,
    groupError,
    activeGroupId,
    groupCreateOpen,
    groupInviteOpen,
    onCreateGroup,
    onOpenGroupCreate,
    onCloseGroupCreate,
    onOpenGroup,
    onBackToGroups,
    onOpenGroupInvite,
    onCloseGroupInvite,
    onInvite,
    onRemoveInvite,
    onAcceptInvite,
    onDeclineInvite,
    onUpdateMember,
    onRemoveMember,
    onLeaveGroup,
    onUpdateGroup,
    onDeleteGroup,
    draggedCardId,
    dropTargetId,
    dropTargetPosition,
    folderDropTargetId,
    pathDropTargetId,
    selectedFileIds,
    selectedFolderIds,
    selectedCount,
    allVisibleSelected,
    moveTargets,
    onOpenFolder,
    onShareFolder,
    onDownloadFolder,
    onRenameFolder,
    onToggleFolderFavourite,
    onDelete,
    onRestore,
    onRestoreVersion,
    onPermanentDelete,
    onDownload,
    onPreview,
    onRename,
    onShare,
    onNote,
    onMoveFile,
    onToggleFavourite,
    onCreateTag,
    onAddTagToFile,
    onRemoveTagFromFile,
    onDragStartCard,
    onDragEnterCard,
    onDragOverCard,
    onDragLeaveCard,
    onDropCard,
    onDragEndCard,
    onMoveCardByKeyboard,
    onFileDragEnterFolder,
    onFileDragLeaveFolder,
    onDropFileOnFolder,
    onFileDragEnterPath,
    onFileDragLeavePath,
    onDropFileOnPath,
    onToggleFileSelected,
    onToggleFolderSelected,
    onToggleAllVisibleSelected,
    onClearSelection,
    onBulkDelete,
    onBulkRestore,
    onBulkPermanentDelete,
    onBulkDownload,
    onBulkMove,
}: DashboardContentProps) {
    const parentFolder = folderTrail.length > 1 ? folderTrail[folderTrail.length - 2] : null
    const parentMoveTargetId = parentFolder?.id ?? '__root__'
    const [moveTargetId, setMoveTargetId] = useState(parentMoveTargetId)
    const moveTargetOptions = useMemo(() => {
        const options = [{ id: '__root__', label: folderTrail.length === 1 ? 'Parent folder (All files)' : 'Root folder' }]
        if (parentFolder) {
            options.push({ id: parentFolder.id, label: `Parent folder (${parentFolder.name})` })
        }
        moveTargets.forEach((folder) => {
            if (!options.some((option) => option.id === folder.id)) {
                options.push({ id: folder.id, label: folder.name })
            }
        })
        return options
    }, [folderTrail.length, moveTargets, parentFolder])
    const activeMoveTargetId = moveTargetOptions.some((option) => option.id === moveTargetId)
        ? moveTargetId
        : parentMoveTargetId
    const isEmpty = visibleItems.length === 0 && renderedItems.length === 0 && visibleFolders.length === 0
    const shownCount = visibleFolders.length + renderedItems.length
    const totalCount = visibleFolders.length + visibleItems.length
    const hasSearchOrFilter = Boolean(query || hasActiveFilter)
    const resultLabel = totalCount === 1 ? 'item' : 'items'
    const subtitle =
        view === 'groups' || view === 'calendar'
            ? null
            : loading
              ? 'Loading vault contents'
              : hasSearchOrFilter
                ? `${totalCount} ${resultLabel} match the current view`
                : `${shownCount} ${shownCount === 1 ? 'item' : 'items'} in this view`
    const clearSearchAndFiltersAction = (
        <>
            {query && (
                <button className="btn btn--outline" type="button" onClick={() => onQueryChange('')}>
                    Clear search
                </button>
            )}
            {hasActiveFilter && (
                <button className="btn btn--outline" type="button" onClick={onClearFilters}>
                    Clear filters
                </button>
            )}
        </>
    )

    return (
        <div
            className={`shell__content ${dragActive ? 'is-dragging' : ''}`}
            onDragOver={(event) => {
                if (!isFileDrag(event)) return
                event.preventDefault()
                onDragActiveChange(true)
            }}
            onDragLeave={() => onDragActiveChange(false)}
            onDrop={(event) => {
                if (!isFileDrag(event)) return
                onDrop(event)
            }}
        >
            <div className="shell__content-head">
                <div>
                    <h1 className="shell__title">{titleForView(view)}</h1>
                    {subtitle && <p className="shell__subtitle">{subtitle}</p>}
                </div>

                <DashboardToolbar
                    view={view}
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
                    hasActiveFilter={hasActiveFilter}
                    sizeSliderMax={sizeSliderMax}
                    sizeSliderMinValue={sizeSliderMinValue}
                    sizeSliderMaxValue={sizeSliderMaxValue}
                    sizeSliderMinPct={sizeSliderMinPct}
                    sizeSliderMaxPct={sizeSliderMaxPct}
                    onToggleSortMenu={onToggleSortMenu}
                    onCloseSortMenu={onCloseSortMenu}
                    onSortKeyChange={onSortKeyChange}
                    onToggleFilterMenu={onToggleFilterMenu}
                    onCloseFilterMenu={onCloseFilterMenu}
                    onQueryChange={onQueryChange}
                    onClearFileTypes={onClearFileTypes}
                    onToggleFileType={onToggleFileType}
                    onVisibilityChange={onVisibilityChange}
                    onTagChange={onTagChange}
                    onSizeInputChange={onSizeInputChange}
                    onSizeSliderChange={onSizeSliderChange}
                    onExcludedExtensionsChange={onExcludedExtensionsChange}
                    onModifiedDateChange={onModifiedDateChange}
                    onClearFilters={onClearFilters}
                    onLayoutModeChange={onLayoutModeChange}
                    onOpenFileCreate={onOpenFileCreate}
                    onOpenFolderCreate={onOpenFolderCreate}
                    onUploadChange={onUploadChange}
                />
            </div>

            {view === 'all' && folderTrail.length > 0 && (
                <FolderBreadcrumbs
                    folderTrail={folderTrail}
                    onOpenRoot={onOpenRoot}
                    onOpenFolderAt={onOpenFolderAt}
                    canAcceptFileDrop={Boolean(draggedCardId)}
                    dropTargetId={pathDropTargetId}
                    onFileDragEnter={onFileDragEnterPath}
                    onFileDragLeave={onFileDragLeavePath}
                    onFileDrop={onDropFileOnPath}
                />
            )}

            {error && (
                <p className="shell__error" role="alert">
                    {error}
                </p>
            )}

            {view === 'all' && (
                <TransferQueuePanel
                    transfers={uploadTransfers}
                    onPause={onPauseTransfer}
                    onResume={onResumeTransfer}
                    onRetry={onRetryTransfer}
                    onRemove={onRemoveTransfer}
                    onPauseAll={onPauseAllTransfers}
                    onResumeAll={onResumeAllTransfers}
                />
            )}

            {selectedCount > 0 && (view === 'all' || view === 'favourites' || view === 'trash') && (
                <div className="bulk-actions" role="region" aria-label="Bulk file actions">
                    <label className="bulk-actions__select-all">
                        <input type="checkbox" checked={allVisibleSelected} onChange={onToggleAllVisibleSelected} />
                        <span>{selectedCount} selected</span>
                    </label>
                    <div className="bulk-actions__buttons">
                        {view !== 'trash' && (
                            <>
                                <select
                                    className="bulk-actions__target"
                                    value={activeMoveTargetId}
                                    onChange={(event) => setMoveTargetId(event.target.value)}
                                    aria-label="Move destination"
                                >
                                    {moveTargetOptions.map((target) => (
                                        <option key={target.id} value={target.id}>
                                            {target.label}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="btn btn--outline"
                                    type="button"
                                    onClick={() => void onBulkMove(activeMoveTargetId === '__root__' ? null : activeMoveTargetId)}
                                >
                                    Move
                                </button>
                                <button className="btn btn--outline" type="button" onClick={() => void onBulkDownload()}>
                                    Download
                                </button>
                                <button className="btn btn--outline" type="button" onClick={() => void onBulkDelete()}>
                                    Move to trash
                                </button>
                            </>
                        )}
                        {view === 'trash' && (
                            <>
                                <button className="btn btn--outline" type="button" onClick={() => void onBulkRestore()}>
                                    Restore
                                </button>
                                <button className="btn btn--outline" type="button" onClick={() => void onBulkPermanentDelete()}>
                                    Delete forever
                                </button>
                            </>
                        )}
                        <button className="btn btn--ghost" type="button" onClick={onClearSelection}>
                            Clear
                        </button>
                    </div>
                </div>
            )}

            {loading && <p className="shell__loading">Loading...</p>}

            {!loading && view === 'shared' && isEmpty && (
                <EmptyPane
                    title={query ? 'No shared files match your search' : hasActiveFilter ? 'No shared files match your filters' : 'Nothing shared yet'}
                    body={
                        query || hasActiveFilter
                            ? 'Adjust the search or filter to see more shared files.'
                            : 'Files someone shares with you will show up here, still encrypted end-to-end.'
                    }
                    actions={(query || hasActiveFilter) && clearSearchAndFiltersAction}
                />
            )}

            {!loading && view === 'groups' && (
                <GroupsPanel
                    groups={groups}
                    incomingInvites={incomingGroupInvites}
                    error={groupError}
                    activeGroupId={activeGroupId}
                    createOpen={groupCreateOpen}
                    inviteOpen={groupInviteOpen}
                    onCreateGroup={onCreateGroup}
                    onOpenCreate={onOpenGroupCreate}
                    onCloseCreate={onCloseGroupCreate}
                    onOpenGroup={onOpenGroup}
                    onBackToGroups={onBackToGroups}
                    onOpenInvite={onOpenGroupInvite}
                    onCloseInvite={onCloseGroupInvite}
                    onInvite={onInvite}
                    onRemoveInvite={onRemoveInvite}
                    onAcceptInvite={onAcceptInvite}
                    onDeclineInvite={onDeclineInvite}
                    onUpdateMember={onUpdateMember}
                    onRemoveMember={onRemoveMember}
                    onLeaveGroup={onLeaveGroup}
                    onUpdateGroup={onUpdateGroup}
                    onDeleteGroup={onDeleteGroup}
                />
            )}

            {!loading && view === 'favourites' && isEmpty && (
                <EmptyPane
                    title={query ? 'No favourites match your search' : hasActiveFilter ? 'No favourites match your filters' : 'No favourites yet'}
                    body={
                        query || hasActiveFilter
                            ? 'Adjust the search or filter to see more favourites.'
                            : 'Tap the star on any file to pin it here for quick access.'
                    }
                    actions={(query || hasActiveFilter) && clearSearchAndFiltersAction}
                />
            )}

            {!loading && view === 'calendar' && (
                <CalendarPanel
                    files={storageItems}
                    onPreview={onPreview}
                    onDownload={(item) => void onDownload(item)}
                />
            )}

            {!loading && view === 'trash' && isEmpty && (
                <EmptyPane
                    title={hasActiveFilter || query ? 'No deleted files match' : 'Trash is empty'}
                    body={
                        hasActiveFilter || query
                            ? 'Adjust the search or filter to see more deleted files.'
                            : `Deleted files stay here for ${currentUser?.trash_retention_days ?? 30} days before they're gone for good.`
                    }
                    actions={(query || hasActiveFilter) && clearSearchAndFiltersAction}
                />
            )}

            {!loading && view === 'all' && visibleFolders.length === 0 && isEmpty && (
                <EmptyPane
                    title={query ? 'No files match your search' : hasActiveFilter ? 'No files match your filters' : 'Drop files to encrypt and sync'}
                    body={
                        query || hasActiveFilter
                            ? 'Try a different name, or clear the filter to see everything.'
                            : 'Files are locked with AES-256 on this device before they ever reach the network.'
                    }
                    actions={
                        query || hasActiveFilter ? (
                            clearSearchAndFiltersAction
                        ) : (
                            <>
                                <label className="btn btn--solid">
                                    Upload files
                                    <input type="file" multiple onChange={onUploadChange} style={{ display: 'none' }} />
                                </label>
                                <button className="btn btn--outline" type="button" onClick={onOpenFolderCreate}>
                                    New folder
                                </button>
                            </>
                        )
                    }
                />
            )}

            {!loading && (visibleFolders.length > 0 || renderedItems.length > 0) && (
                <DashboardFileGrid
                    visibleFolders={visibleFolders}
                    renderedItems={renderedItems}
                    exitingIds={exitingIds}
                    pendingIds={pendingIds}
                    uploadTransfers={uploadTransfers}
                    favouriteIds={favouriteIds}
                    folderFavouriteIds={folderFavouriteIds}
                    tags={tags}
                    fileTagsByFileId={fileTagsByFileId}
                    view={view}
                    layoutMode={layoutMode}
                    layoutSwitchTarget={layoutSwitchTarget}
                    sortKey={sortKey}
                    draggedCardId={draggedCardId}
                    dropTargetId={dropTargetId}
                    dropTargetPosition={dropTargetPosition}
                    folderDropTargetId={folderDropTargetId}
                    selectedFileIds={selectedFileIds}
                    selectedFolderIds={selectedFolderIds}
                    onOpenFolder={onOpenFolder}
                    onShareFolder={onShareFolder}
                    onDownloadFolder={onDownloadFolder}
                    onRenameFolder={onRenameFolder}
                    onToggleFolderFavourite={onToggleFolderFavourite}
                    onDelete={onDelete}
                    onRestore={onRestore}
                    onRestoreVersion={onRestoreVersion}
                    onPermanentDelete={onPermanentDelete}
                    onDownload={onDownload}
                    onPreview={onPreview}
                    onRename={onRename}
                    onShare={onShare}
                    onNote={onNote}
                    onMoveFile={onMoveFile}
                    onToggleFavourite={onToggleFavourite}
                    onCreateTag={onCreateTag}
                    onAddTagToFile={onAddTagToFile}
                    onRemoveTagFromFile={onRemoveTagFromFile}
                    onDragStartCard={onDragStartCard}
                    onDragEnterCard={onDragEnterCard}
                    onDragOverCard={onDragOverCard}
                    onDragLeaveCard={onDragLeaveCard}
                    onDropCard={onDropCard}
                    onDragEndCard={onDragEndCard}
                    onMoveCardByKeyboard={onMoveCardByKeyboard}
                    onFileDragEnterFolder={onFileDragEnterFolder}
                    onFileDragLeaveFolder={onFileDragLeaveFolder}
                    onDropFileOnFolder={onDropFileOnFolder}
                    onToggleFileSelected={onToggleFileSelected}
                    onToggleFolderSelected={onToggleFolderSelected}
                />
            )}

            {dragActive && (
                <div className="dropzone-overlay">
                    <p>Drop to encrypt &amp; upload</p>
                </div>
            )}
        </div>
    )
}
