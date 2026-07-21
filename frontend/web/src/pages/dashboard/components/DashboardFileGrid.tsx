import React, { type DragEvent } from 'react'
import type { ApiFolder } from '../../../api/files'
import { FileCard } from './FileCard'
import { FolderCard } from './FolderCard'
import type { UploadTransfer } from '../hooks/useFileUpload'
import type { Item, LayoutMode, ViewKey } from '../types'

type DashboardFileGridProps = {
    visibleFolders: ApiFolder[]
    renderedItems: Item[]
    exitingIds: Set<string>
    pendingIds: Set<string>
    uploadTransfers: UploadTransfer[]
    favouriteIds: Set<string>
    folderFavouriteIds: Set<string>
    view: ViewKey
    layoutMode: LayoutMode
    layoutSwitchTarget: LayoutMode | null
    sortKey: string
    draggedCardId: string | null
    dropTargetId: string | null
    onOpenFolder: (folder: ApiFolder) => void
    onShareFolder: (folder: ApiFolder) => void
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
    onToggleFavourite: (id: string) => void | Promise<void>
    onDragStartCard: (id: string, e: DragEvent<HTMLElement>) => void
    onDragEnterCard: (id: string) => void
    onDragLeaveCard: (id: string) => void
    onDropCard: (id: string, e: DragEvent<HTMLElement>) => void
    onDragEndCard: () => void
    onMoveCardByKeyboard: (id: string, offset: number) => void
}

export function DashboardFileGrid({
    visibleFolders,
    renderedItems,
    exitingIds,
    pendingIds,
    uploadTransfers,
    favouriteIds,
    folderFavouriteIds,
    view,
    layoutMode,
    layoutSwitchTarget,
    sortKey,
    draggedCardId,
    dropTargetId,
    onOpenFolder,
    onShareFolder,
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
    onToggleFavourite,
    onDragStartCard,
    onDragEnterCard,
    onDragLeaveCard,
    onDropCard,
    onDragEndCard,
    onMoveCardByKeyboard,
}: DashboardFileGridProps) {
    const transferStatusByTempId = new Map(uploadTransfers.map((transfer) => [transfer.tempId, transfer.status]))

    return (
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
                    onOpen={onOpenFolder}
                    onShare={onShareFolder}
                    onRename={onRenameFolder}
                    isFavourite={folderFavouriteIds.has(folder.id)}
                    onToggleFavourite={view === 'all' || view === 'favourites' ? onToggleFolderFavourite : undefined}
                />
            ))}
            {renderedItems.map((item, i) => {
                const isSearchExiting = exitingIds.has(item.id)

                return (
                    <FileCard
                        key={item.id}
                        item={item}
                        index={visibleFolders.length + i}
                        pending={pendingIds.has(item.id)}
                        transferStatus={transferStatusByTempId.get(item.id)}
                        view={view}
                        onDelete={view === 'all' ? onDelete : undefined}
                        onRestore={view === 'trash' ? onRestore : undefined}
                        onRestoreVersion={view === 'all' || view === 'favourites' ? onRestoreVersion : undefined}
                        onPermanentDelete={view === 'trash' ? onPermanentDelete : undefined}
                        onDownload={view !== 'trash' ? onDownload : undefined}
                        onPreview={view !== 'trash' ? onPreview : undefined}
                        onRename={view === 'all' || view === 'favourites' ? onRename : undefined}
                        onShare={view === 'all' || view === 'favourites' ? onShare : undefined}
                        onNote={view === 'all' || view === 'favourites' ? onNote : undefined}
                        isFavourite={favouriteIds.has(item.id)}
                        onToggleFavourite={view === 'all' || view === 'favourites' ? onToggleFavourite : undefined}
                        draggable={sortKey === 'manual' && !pendingIds.has(item.id) && !isSearchExiting}
                        isDragging={draggedCardId === item.id}
                        isDropTarget={dropTargetId === item.id}
                        isSearchExiting={isSearchExiting}
                        style={{ '--file-index': visibleFolders.length + i } as React.CSSProperties}
                        onDragStartCard={onDragStartCard}
                        onDragEnterCard={onDragEnterCard}
                        onDragLeaveCard={onDragLeaveCard}
                        onDropCard={onDropCard}
                        onDragEndCard={onDragEndCard}
                        onMoveCardByKeyboard={onMoveCardByKeyboard}
                    />
                )
            })}
        </div>
    )
}
