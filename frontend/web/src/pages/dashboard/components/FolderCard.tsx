import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ApiFolder } from '../../../api/files'
import { formatRelative } from '../fileUtils'
import { CANCEL_ICON, CHECK_ICON, INFO_ICON, RENAME_ICON, SHARE_ICON, STAR_ICON_FILLED, STAR_ICON_OUTLINE } from '../icons'
import { FileRenameInput } from './FileRenameInput'
import { FileInfoPopover, type InfoPopoverPosition } from './FileInfoPopover'

export function FolderCard({
    folder,
    index,
    onOpen,
    onShare,
    onRename,
    isFavourite,
    onToggleFavourite,
}: {
    folder: ApiFolder
    index: number
    onOpen: (folder: ApiFolder) => void
    onShare?: (folder: ApiFolder) => void | Promise<void>
    onRename?: (folder: ApiFolder, name: string, description: string | null) => Promise<void>
    isFavourite?: boolean
    onToggleFavourite?: ((id: string) => void | Promise<void>) | undefined
}) {
    const fileCountLabel = folder.file_count === 1 ? '1 file' : `${folder.file_count} files`
    const [favouriteTouched, setFavouriteTouched] = useState(false)
    const [isRenaming, setIsRenaming] = useState(false)
    const [renameDraft, setRenameDraft] = useState(folder.name)
    const [descriptionDraft, setDescriptionDraft] = useState(folder.description ?? '')
    const [renameSaving, setRenameSaving] = useState(false)
    const [isInfoOpen, setIsInfoOpen] = useState(false)
    const [infoPosition, setInfoPosition] = useState<InfoPopoverPosition>({ left: 14, top: 14 })
    const renameInputRef = useRef<HTMLInputElement>(null)
    const cardRef = useRef<HTMLElement>(null)
    const infoPositionFrameRef = useRef<number | null>(null)

    const updateInfoPosition = useCallback(() => {
        const card = cardRef.current
        if (!card) return

        const rect = card.getBoundingClientRect()
        const gap = 12
        const edge = 14
        const width = Math.min(360, window.innerWidth - edge * 2)
        const right = rect.right + gap
        const left = rect.left - width - gap
        const fitsRight = right + width <= window.innerWidth - edge
        const fitsLeft = left >= edge
        const nextLeft = fitsRight
            ? right
            : fitsLeft
              ? left
              : Math.min(Math.max(rect.left, edge), window.innerWidth - width - edge)
        const rawTop = fitsRight || fitsLeft ? rect.top : rect.bottom + gap
        const maxTop = Math.max(edge, window.innerHeight - edge - 240)

        setInfoPosition({
            left: nextLeft,
            top: Math.min(Math.max(rawTop, edge), maxTop),
        })
    }, [])

    const scheduleInfoPositionUpdate = useCallback(() => {
        if (infoPositionFrameRef.current !== null) return

        infoPositionFrameRef.current = window.requestAnimationFrame(() => {
            infoPositionFrameRef.current = null
            updateInfoPosition()
        })
    }, [updateInfoPosition])

    useEffect(() => {
        if (!isInfoOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsInfoOpen(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isInfoOpen])

    useEffect(() => {
        if (!isInfoOpen) return

        scheduleInfoPositionUpdate()
        window.addEventListener('resize', scheduleInfoPositionUpdate)
        window.addEventListener('scroll', scheduleInfoPositionUpdate, true)
        return () => {
            window.removeEventListener('resize', scheduleInfoPositionUpdate)
            window.removeEventListener('scroll', scheduleInfoPositionUpdate, true)
            if (infoPositionFrameRef.current !== null) {
                window.cancelAnimationFrame(infoPositionFrameRef.current)
                infoPositionFrameRef.current = null
            }
        }
    }, [isInfoOpen, scheduleInfoPositionUpdate])

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
            ref={cardRef}
            className={`file-card folder-card file-card--can-preview ${onToggleFavourite ? 'file-card--has-favourite' : ''}`}
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
            {onToggleFavourite && (
                <button
                    className={`file-card__fav ${isFavourite ? 'is-active' : ''} ${
                        favouriteTouched ? 'has-favourite-motion' : ''
                    }`}
                    onClick={(event) => {
                        event.stopPropagation()
                        setFavouriteTouched(true)
                        void onToggleFavourite(folder.id)
                    }}
                    aria-label={isFavourite ? 'Remove folder from favourites' : 'Add folder to favourites'}
                    aria-pressed={isFavourite}
                    type="button"
                >
                    {isFavourite ? STAR_ICON_FILLED : STAR_ICON_OUTLINE}
                </button>
            )}
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
                    <p className="file-card__name" title={folder.name}>
                        {folder.name}
                    </p>
                )}
            </div>
            <p className="file-card__meta">
                {fileCountLabel} · Updated {formatRelative(folder.updated_at)}
            </p>
            {(onRename || onShare || !isRenaming) && (
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
                    {!isRenaming && (
                        <div className="file-card__info-wrap">
                            <button
                                className={`file-card__action file-card__action--info ${isInfoOpen ? 'is-active' : ''}`}
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    if (!isInfoOpen) scheduleInfoPositionUpdate()
                                    setIsInfoOpen((current) => !current)
                                }}
                                aria-label={`Show details for ${folder.name}`}
                                aria-expanded={isInfoOpen}
                                title="Info"
                            >
                                {INFO_ICON}
                            </button>
                            {isInfoOpen && (
                                <FileInfoPopover
                                    item={folder}
                                    position={infoPosition}
                                    onClose={() => setIsInfoOpen(false)}
                                />
                            )}
                        </div>
                    )}
                </div>
            )}
        </article>
    )
}
