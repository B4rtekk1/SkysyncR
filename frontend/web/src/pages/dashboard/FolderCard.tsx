import { useRef, useState, type CSSProperties } from 'react'
import type { ApiFolder } from '../../api/files'
import { formatRelative } from './fileUtils'
import { CANCEL_ICON, CHECK_ICON, RENAME_ICON, SHARE_ICON } from './icons'
import { FileRenameInput } from './FileRenameInput'

export function FolderCard({
    folder,
    index,
    onOpen,
    onShare,
    onRename,
}: {
    folder: ApiFolder
    index: number
    onOpen: (folder: ApiFolder) => void
    onShare?: (folder: ApiFolder) => void | Promise<void>
    onRename?: (folder: ApiFolder, name: string, description: string | null) => Promise<void>
}) {
    const fileCountLabel = folder.file_count === 1 ? '1 file' : `${folder.file_count} files`
    const [isRenaming, setIsRenaming] = useState(false)
    const [renameDraft, setRenameDraft] = useState(folder.name)
    const [descriptionDraft, setDescriptionDraft] = useState(folder.description ?? '')
    const [renameSaving, setRenameSaving] = useState(false)
    const renameInputRef = useRef<HTMLInputElement>(null)

    const cancelRename = () => {
        setRenameDraft(folder.name)
        setDescriptionDraft(folder.description ?? '')
        setIsRenaming(false)
    }

    const saveRename = async () => {
        const nextName = renameDraft.trim()
        const nextDescription = descriptionDraft.trim()
        const currentDescription = folder.description ?? ''
        if (!nextName || renameSaving) {
            cancelRename()
            return
        }
        if (nextName === folder.name && nextDescription === currentDescription) {
            setIsRenaming(false)
            return
        }

        setRenameSaving(true)
        try {
            await onRename?.(folder, nextName, nextDescription || null)
            setIsRenaming(false)
        } finally {
            setRenameSaving(false)
        }
    }

    const startRename = () => {
        setRenameDraft(folder.name)
        setDescriptionDraft(folder.description ?? '')
        setIsRenaming(true)
        window.requestAnimationFrame(() => {
            renameInputRef.current?.focus()
            renameInputRef.current?.select()
        })
    }

    return (
        <article
            className="file-card folder-card file-card--can-preview"
            style={{ '--file-index': index } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-label={`Open folder ${folder.name}`}
            onClick={() => {
                if (!isRenaming) onOpen(folder)
            }}
            onKeyDown={(event) => {
                if (isRenaming) return
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen(folder)
            }}
        >
            <div className="file-card__top">
                <span className="file-card__badge folder-card__badge">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="M3.5 7.5a2 2 0 0 1 2-2h4.4l2 2H18.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinejoin="round"
                        />
                    </svg>
                    Folder
                </span>
            </div>
            <div className="file-card__name-slot">
                {isRenaming ? (
                    <div className="folder-card__edit" onClick={(event) => event.stopPropagation()}>
                        <FileRenameInput
                            filename={folder.name}
                            value={renameDraft}
                            ref={renameInputRef}
                            onChange={setRenameDraft}
                            onSave={() => void saveRename()}
                            onCancel={cancelRename}
                            disabled={renameSaving}
                        />
                        <textarea
                            className="folder-card__description-input"
                            value={descriptionDraft}
                            onChange={(event) => setDescriptionDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') cancelRename()
                                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void saveRename()
                            }}
                            placeholder="Folder description"
                            disabled={renameSaving}
                            rows={3}
                        />
                    </div>
                ) : (
                    <>
                        <p className="file-card__name" title={folder.name}>
                            {folder.name}
                        </p>
                        {folder.description && (
                            <p className="folder-card__description" title={folder.description}>
                                {folder.description}
                            </p>
                        )}
                    </>
                )}
            </div>
            <p className="file-card__meta">
                {fileCountLabel} · Updated {formatRelative(folder.updated_at)}
            </p>
            {(onRename || onShare) && (
                <div className="file-card__actions">
                    {isRenaming && (
                        <>
                            <button
                                className="file-card__action file-card__action--confirm"
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    void saveRename()
                                }}
                                disabled={renameSaving}
                                aria-label={`Save name for ${folder.name}`}
                                title="Save name"
                            >
                                {CHECK_ICON}
                            </button>
                            <button
                                className="file-card__action file-card__action--cancel"
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    cancelRename()
                                }}
                                disabled={renameSaving}
                                aria-label={`Cancel rename for ${folder.name}`}
                                title="Cancel"
                            >
                                {CANCEL_ICON}
                            </button>
                        </>
                    )}
                    {onRename && !isRenaming && (
                        <button
                            className="file-card__action file-card__action--rename"
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                startRename()
                            }}
                            aria-label={`Rename folder ${folder.name}`}
                            title="Rename"
                        >
                            {RENAME_ICON}
                        </button>
                    )}
                    {onShare && !isRenaming && (
                        <button
                            className={`file-card__action file-card__action--share ${folder.is_public ? 'is-active' : ''}`}
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                void onShare(folder)
                            }}
                            aria-label={`Share folder ${folder.name}`}
                            aria-pressed={folder.is_public}
                            title="Share"
                        >
                            {SHARE_ICON}
                        </button>
                    )}
                </div>
            )}
        </article>
    )
}
