import { useEffect, useState } from 'react'
import { listFolders, type ApiFolder } from '../../../api/files'
import { decryptFoldersMetadata } from '../encryptedMetadata'
import type { Item } from '../types'

type FolderTreeNode = ApiFolder & {
    children: FolderTreeNode[]
}

type MoveFileModalProps = {
    item: Item
    privateKey: CryptoKey | null
    moving: boolean
    onClose: () => void
    onMove: (item: Item, folderId: string | null) => Promise<void>
}

async function loadFolderTree(privateKey: CryptoKey, parentFolderId?: string): Promise<FolderTreeNode[]> {
    const folders = await listFolders(parentFolderId)
    const visibleFolders = await decryptFoldersMetadata(folders, privateKey)
    const children = await Promise.all(
        visibleFolders.map(async (folder) => ({
            ...folder,
            children: await loadFolderTree(privateKey, folder.id),
        })),
    )

    return children.sort((a, b) => a.name.localeCompare(b.name))
}

export function MoveFileModal({ item, privateKey, moving, onClose, onMove }: MoveFileModalProps) {
    const [tree, setTree] = useState<FolderTreeNode[]>([])
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(item.folder_id ?? null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const canMove = selectedFolderId !== (item.folder_id ?? null) && !loading && !moving

    useEffect(() => {
        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [onClose])

    useEffect(() => {
        let active = true

        async function loadTree() {
            if (!privateKey) {
                setError('Private key is locked. Sign in again to move files.')
                setLoading(false)
                return
            }

            try {
                setLoading(true)
                setError(null)
                const folders = await loadFolderTree(privateKey)
                if (active) setTree(folders)
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load folders.')
            } finally {
                if (active) setLoading(false)
            }
        }

        void loadTree()

        return () => {
            active = false
        }
    }, [privateKey])

    return (
        <div className="file-filter__modal is-opening" role="presentation" onMouseDown={onClose}>
            <div
                className="file-filter__dialog move-file"
                role="dialog"
                aria-modal="true"
                aria-labelledby="move-file-title"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="file-filter__modal-head">
                    <div>
                        <span className="eyebrow">Move file</span>
                        <h2 id="move-file-title">{item.filename}</h2>
                    </div>
                    <button className="file-filter__close" type="button" onClick={onClose} aria-label="Close move dialog">
                        x
                    </button>
                </div>

                <div className="file-filter__modal-body">
                    {error && (
                        <p className="shell__error" role="alert">
                            {error}
                        </p>
                    )}
                    {loading ? (
                        <p className="move-file__loading">
                            <span className="spinner" /> Loading folders...
                        </p>
                    ) : (
                        <div className="move-file__tree" role="tree" aria-label="Move destination">
                            <div className="move-file__root">
                                <button
                                    className={`move-file__target move-file__target--root ${selectedFolderId === null ? 'is-selected' : ''}`}
                                    type="button"
                                    role="treeitem"
                                    aria-selected={selectedFolderId === null}
                                    aria-expanded={tree.length > 0}
                                    onClick={() => setSelectedFolderId(null)}
                                >
                                    <span className="move-file__folder-icon" aria-hidden="true" />
                                    <span>All files</span>
                                    {item.folder_id === null && <small>Current</small>}
                                </button>
                                {tree.length > 0 && (
                                    <ul className="move-file__branches" role="group">
                                        {tree.map((folder) => (
                                            <FolderTreeItem
                                                key={folder.id}
                                                folder={folder}
                                                currentFolderId={item.folder_id ?? null}
                                                selectedFolderId={selectedFolderId}
                                                onSelect={setSelectedFolderId}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="file-filter__footer">
                    <button className="btn btn--ghost" type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn btn--solid"
                        type="button"
                        disabled={!canMove}
                        onClick={() => void onMove(item, selectedFolderId)}
                    >
                        {moving ? 'Moving...' : 'Move'}
                    </button>
                </div>
            </div>
        </div>
    )
}

function FolderTreeItem({
    folder,
    currentFolderId,
    selectedFolderId,
    onSelect,
}: {
    folder: FolderTreeNode
    currentFolderId: string | null
    selectedFolderId: string | null
    onSelect: (folderId: string) => void
}) {
    const selected = selectedFolderId === folder.id
    const current = currentFolderId === folder.id
    const hasChildren = folder.children.length > 0

    return (
        <li className="move-file__branch" role="none">
            <div className="move-file__branch-row">
                <span className="move-file__connector" aria-hidden="true" />
                <button
                    className={`move-file__target ${selected ? 'is-selected' : ''}`}
                    type="button"
                    role="treeitem"
                    aria-selected={selected}
                    aria-expanded={hasChildren ? true : undefined}
                    onClick={() => onSelect(folder.id)}
                >
                    <span className="move-file__folder-icon" aria-hidden="true" />
                    <span>{folder.name}</span>
                    {current && <small>Current</small>}
                </button>
            </div>
            {hasChildren && (
                <ul className="move-file__branches" role="group">
                    {folder.children.map((child) => (
                        <FolderTreeItem
                            key={child.id}
                            folder={child}
                            currentFolderId={currentFolderId}
                            selectedFolderId={selectedFolderId}
                            onSelect={onSelect}
                        />
                    ))}
                </ul>
            )}
        </li>
    )
}
