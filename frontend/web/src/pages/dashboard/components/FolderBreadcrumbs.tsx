import type { DragEvent } from 'react'
import type { ApiFolder } from '../../../api/files'

type FolderBreadcrumbsProps = {
    folderTrail: ApiFolder[]
    onOpenRoot: () => void
    onOpenFolderAt: (folder: ApiFolder, index: number) => void
    canAcceptFileDrop?: boolean
    dropTargetId?: string | null
    onFileDragEnter?: (targetFolderId: string | null) => void
    onFileDragLeave?: (targetFolderId: string | null) => void
    onFileDrop?: (targetFolderId: string | null, event: DragEvent<HTMLButtonElement>) => void
}

export function FolderBreadcrumbs({
    folderTrail,
    onOpenRoot,
    onOpenFolderAt,
    canAcceptFileDrop = false,
    dropTargetId,
    onFileDragEnter,
    onFileDragLeave,
    onFileDrop,
}: FolderBreadcrumbsProps) {
    const targetKey = (targetFolderId: string | null) => targetFolderId ?? '__root__'
    const dropClass = (targetFolderId: string | null) =>
        dropTargetId === targetKey(targetFolderId) ? ' is-folder-path-drop-target' : ''
    const dropProps = (targetFolderId: string | null) =>
        canAcceptFileDrop
            ? {
                  onDragEnter: (event: DragEvent<HTMLButtonElement>) => {
                      event.preventDefault()
                      onFileDragEnter?.(targetFolderId)
                  },
                  onDragOver: (event: DragEvent<HTMLButtonElement>) => event.preventDefault(),
                  onDragLeave: () => onFileDragLeave?.(targetFolderId),
                  onDrop: (event: DragEvent<HTMLButtonElement>) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onFileDrop?.(targetFolderId, event)
                  },
              }
            : {}

    return (
        <div className="folder-path" aria-label="Current folder">
            <button className={dropClass(null).trim()} type="button" onClick={onOpenRoot} {...dropProps(null)}>
                All files
            </button>
            {folderTrail.map((folder, index) => (
                <span key={folder.id}>
                    <span aria-hidden="true">/</span>
                    <button
                        className={dropClass(folder.id).trim()}
                        type="button"
                        onClick={() => onOpenFolderAt(folder, index)}
                        {...dropProps(folder.id)}
                    >
                        {folder.name}
                    </button>
                </span>
            ))}
        </div>
    )
}
