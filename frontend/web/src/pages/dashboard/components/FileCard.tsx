import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type DragEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { FileCardActions } from './FileCardActions'
import { FileCardHeader } from './FileCardHeader'
import { FileInfoPopover, type InfoPopoverPosition } from './FileInfoPopover'
import { FileRenameInput } from './FileRenameInput'
import { DRAG_HANDLE_ICON, STAR_ICON_FILLED, STAR_ICON_OUTLINE } from '../icons'
import type { Item, ViewKey } from '../types'
import { KIND_LABELS, formatBytes, formatRelative, kindFromFile, useDecryptReveal } from '../fileUtils'
import { isShared } from '../fileCardUtils'
import type { FileTag, Tag } from '../../../api/tags'
import type { UploadTransferStatus } from '../hooks/useFileUpload'

export function FileCard({
                      item,
                      index,
                      pending,
                      transferStatus,
                      onDelete,
                      onRestore,
                      onRestoreVersion,
                      onPermanentDelete,
                      onDownload,
                      onPreview,
                      onRename,
                      onShare,
                      onNote,
                      onMove,
                      view,
                      isFavourite,
                      onToggleFavourite,
                      tags = [],
                      allTags = [],
                      onCreateTag,
                      onAddTag,
                      onRemoveTag,
                      draggable,
                      reorderable,
                      isDragging,
                      isDropTarget,
                      isSearchExiting,
                      selected,
                      onToggleSelected,
                      style,
                      onDragStartCard,
                      onDragEnterCard,
                      onDragLeaveCard,
                      onDropCard,
                      onDragEndCard,
                      onMoveCardByKeyboard,
                  }: {
    item: Item
    index: number
    pending: boolean
    transferStatus: UploadTransferStatus | undefined
    onDelete?: ((id: string) => void) | undefined
    onRestore?: ((id: string) => void) | undefined
    onRestoreVersion?: ((item: Item, versionId: string) => unknown | Promise<unknown>) | undefined
    onPermanentDelete?: ((id: string) => void) | undefined
    onDownload?: ((item: Item) => void) | undefined
    onPreview?: ((item: Item) => void) | undefined
    onRename?: ((item: Item, filename: string) => Promise<void>) | undefined
    onShare?: ((item: Item) => void | Promise<void>) | undefined
    onNote?: ((item: Item) => void) | undefined
    onMove?: ((item: Item) => void | Promise<void>) | undefined
    view: ViewKey
    isFavourite?: boolean
    onToggleFavourite?: ((id: string) => void | Promise<void>) | undefined
    tags?: FileTag[]
    allTags?: Tag[]
    onCreateTag?: ((name: string) => Promise<Tag | null>) | undefined
    onAddTag?: ((fileId: string, tagId: string) => void | Promise<void>) | undefined
    onRemoveTag?: ((fileId: string, tagId: string) => void | Promise<void>) | undefined
    draggable?: boolean
    reorderable?: boolean
    isDragging?: boolean
    isDropTarget?: boolean
    isSearchExiting?: boolean
    selected?: boolean
    onToggleSelected?: ((id: string) => void) | undefined
    style?: CSSProperties
    onDragStartCard?: ((id: string, e: DragEvent<HTMLElement>) => void) | undefined
    onDragEnterCard?: ((id: string) => void) | undefined
    onDragLeaveCard?: ((id: string) => void) | undefined
    onDropCard?: ((id: string, e: DragEvent<HTMLElement>) => void) | undefined
    onDragEndCard?: (() => void) | undefined
    onMoveCardByKeyboard?: ((id: string, offset: number) => void) | undefined
}) {
    const display = useDecryptReveal(item.filename, index * 60)
    const kind = kindFromFile(item.filename, item.mime_type)
    const typeLabel = KIND_LABELS[kind]
    const shared = isShared(item)
    const updatedRelative = formatRelative(item.updated_at)
    const updatedTitle = new Date(item.updated_at).toLocaleString()
    const [favouriteTouched, setFavouriteTouched] = useState(false)
    const [isRenaming, setIsRenaming] = useState(false)
    const [isInfoOpen, setIsInfoOpen] = useState(false)
    const [tagMenuOpen, setTagMenuOpen] = useState(false)
    const [tagDraft, setTagDraft] = useState('')
    const [tagSaving, setTagSaving] = useState(false)
    const [infoPosition, setInfoPosition] = useState<InfoPopoverPosition>({ left: 14, top: 14 })
    const [renameDraft, setRenameDraft] = useState(item.filename)
    const [renameSaving, setRenameSaving] = useState(false)
    const renameInputRef = useRef<HTMLInputElement>(null)
    const cardRef = useRef<HTMLElement>(null)
    const infoPositionFrameRef = useRef<number | null>(null)
    const canToggleFavourite = Boolean(onToggleFavourite && !shared)
    const canRename = Boolean(onRename && !shared && view !== 'trash' && !pending)
    const canShare = Boolean(onShare && !shared && view !== 'trash' && !pending)
    const canNote = Boolean(onNote && !shared && view !== 'trash' && !pending)
    const canMove = Boolean(onMove && !shared && view === 'all' && !pending)
    const canTag = Boolean((onAddTag || onRemoveTag || onCreateTag) && !shared && view !== 'trash' && !pending)
    const canDownload = Boolean(onDownload && view !== 'trash')
    const canPreview = Boolean(onPreview && ['image', 'video', 'pdf', 'text', 'code'].includes(kind) && view !== 'trash' && !pending && !isRenaming)
    const hasAction = Boolean(
        canRename ||
            canShare ||
            canNote ||
            canMove ||
            canTag ||
            canDownload ||
            (view === 'all' && onDelete) ||
            (view === 'trash' && (onRestore || onPermanentDelete)) ||
            !isRenaming,
    )
    const keyboardLabel = reorderable
        ? `${canPreview ? 'Preview' : 'File'} ${item.filename}. Use Alt plus arrow keys to move this file.`
        : canPreview
          ? `Preview ${item.filename}`
          : undefined

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
        if (!tagMenuOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setTagMenuOpen(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [tagMenuOpen])

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

    const isInteractiveClickTarget = (target: EventTarget | null) =>
        target instanceof Element &&
        Boolean(target.closest('button, input, textarea, select, a, [role="button"]'))
    const cancelRename = () => {
        setRenameDraft(item.filename)
        setIsRenaming(false)
    }
    const saveRename = async () => {
        const nextName = renameDraft.trim()
        if (!nextName || nextName === item.filename || renameSaving) {
            cancelRename()
            return
        }

        setRenameSaving(true)
        try {
            await onRename?.(item, nextName)
            setIsRenaming(false)
        } finally {
            setRenameSaving(false)
        }
    }
    const selectFilenameWithoutExtension = (filename: string) => {
        window.requestAnimationFrame(() => {
            const input = renameInputRef.current
            if (!input) return

            const extensionIndex = filename.lastIndexOf('.')
            const selectionEnd = extensionIndex > 0 ? extensionIndex : filename.length
            input.focus()
            input.setSelectionRange(0, selectionEnd)
        })
    }
    const handleCardKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        if (isInteractiveClickTarget(e.target)) return

        if (reorderable && e.altKey) {
            const offset = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
            if (offset !== 0) {
                e.preventDefault()
                onMoveCardByKeyboard?.(item.id, offset)
            }
            return
        }

        if (canPreview && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onPreview?.(item)
        }
    }
    const assignedTagIds = new Set(tags.map((tag) => tag.tag_id))
    const saveTagDraft = async () => {
        const name = tagDraft.trim()
        if (!name || tagSaving) return

        setTagSaving(true)
        try {
            const created = await onCreateTag?.(name)
            if (created) {
                await onAddTag?.(item.id, created.id)
                setTagDraft('')
            }
        } finally {
            setTagSaving(false)
        }
    }

    return (
        <article
            ref={cardRef}
            className={`file-card file-card--${kind} ${canPreview ? 'file-card--can-preview' : ''} ${
                canToggleFavourite ? 'file-card--has-favourite' : ''
            } ${
                hasAction ? 'file-card--has-action' : ''
            } ${shared ? 'file-card--shared' : ''} ${item.is_public ? 'file-card--public' : ''} ${item.note ? 'file-card--has-note' : ''} ${selected ? 'is-selected' : ''} ${pending ? 'file-card--pending' : ''} ${isDragging ? 'is-dragging-card' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${
                isSearchExiting ? 'is-search-exiting' : ''
            }`}
            data-file-kind={kind}
            data-file-id={item.id}
            style={style}
            draggable={draggable && !pending && !isRenaming}
            tabIndex={canPreview || reorderable ? 0 : undefined}
            aria-label={keyboardLabel}
            aria-keyshortcuts={reorderable ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight' : undefined}
            onClick={
                canPreview
                    ? (e) => {
                          if (isInteractiveClickTarget(e.target)) return
                          onPreview?.(item)
                      }
                    : undefined
            }
            onKeyDown={handleCardKeyDown}
            onDragStart={(e) => onDragStartCard?.(item.id, e)}
            onDragEnter={(e) => {
                e.preventDefault()
                onDragEnterCard?.(item.id)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => onDragLeaveCard?.(item.id)}
            onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDropCard?.(item.id, e)
            }}
            onDragEnd={() => onDragEndCard?.()}
        >
            {onToggleSelected && !pending && !isRenaming && (
                <label className="file-card__select" onClick={(event) => event.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        onChange={() => onToggleSelected(item.id)}
                        aria-label={`Select ${item.filename}`}
                    />
                    <span aria-hidden="true" />
                </label>
            )}
            {reorderable && !pending && (
                <span className="file-card__handle" aria-hidden="true">
                    {DRAG_HANDLE_ICON}
                </span>
            )}
            {canToggleFavourite && (
                <button
                    className={`file-card__fav ${isFavourite ? 'is-active' : ''} ${
                        favouriteTouched ? 'has-favourite-motion' : ''
                    }`}
                    onClick={(e) => {
                        e.stopPropagation()
                        setFavouriteTouched(true)
                        void onToggleFavourite?.(item.id)
                    }}
                    aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                    aria-pressed={isFavourite}
                    type="button"
                >
                    {isFavourite ? STAR_ICON_FILLED : STAR_ICON_OUTLINE}
                </button>
            )}
            <FileCardHeader item={item} kind={kind} pending={pending} transferStatus={transferStatus} />
            <div className="file-card__name-slot">
                {isRenaming ? (
                    <FileRenameInput
                        filename={item.filename}
                        value={renameDraft}
                        ref={renameInputRef}
                        onChange={setRenameDraft}
                        onSave={() => void saveRename()}
                        onCancel={cancelRename}
                        disabled={renameSaving}
                    />
                ) : (
                    <p className="file-card__name" title={item.filename}>
                        {display}
                    </p>
                )}
            </div>
            <div className="file-card__meta" aria-label={`${typeLabel}, ${formatBytes(item.size_bytes)}, updated ${updatedRelative}`}>
                <span className="file-card__meta-type">
                    <span className="file-card__meta-dot" aria-hidden="true" />
                    {typeLabel}
                </span>
                <span className="file-card__meta-divider" aria-hidden="true" />
                <span>{formatBytes(item.size_bytes)}</span>
                <span className="file-card__meta-divider" aria-hidden="true" />
                <time dateTime={item.updated_at} title={updatedTitle}>{updatedRelative}</time>
            </div>
            {(shared || item.is_public || item.note) && (
                <div className="file-card__context" aria-label="File status">
                    {shared && (
                        <span className="file-card__context-item file-card__context-item--shared">
                            <span className="file-card__context-icon" aria-hidden="true">↗</span>
                            {item.shared_by_user_name ? `Shared by ${item.shared_by_user_name}` : 'Shared with you'}
                        </span>
                    )}
                    {!shared && item.is_public && (
                        <span className="file-card__context-item file-card__context-item--public">
                            <span className="file-card__context-icon" aria-hidden="true">◎</span>
                            Public link
                        </span>
                    )}
                    {item.note && (
                        <span className="file-card__context-item file-card__context-item--note">
                            <span className="file-card__context-icon" aria-hidden="true">≡</span>
                            Note
                        </span>
                    )}
                </div>
            )}
            {(tags.length > 0 || canTag) && (
                <div className="file-card__tags" onClick={(event) => event.stopPropagation()}>
                    {tags.map((tag) => (
                        <span
                            key={tag.tag_id}
                            className="file-card__tag"
                            style={{ '--tag-color': tag.color ?? '#38bdf8' } as CSSProperties}
                            title={tag.name}
                        >
                            {tag.name}
                        </span>
                    ))}
                    {canTag && (
                        <div className="file-card__tag-menu-wrap">
                            <button
                                className="file-card__tag-add"
                                type="button"
                                onClick={() => setTagMenuOpen((open) => !open)}
                                aria-haspopup="menu"
                                aria-expanded={tagMenuOpen}
                                aria-label={`Manage tags for ${item.filename}`}
                            >
                                +
                            </button>
                            {tagMenuOpen && (
                                <div className="file-card__tag-menu" role="menu" aria-label="File tags">
                                    <div className="file-card__tag-options">
                                        {allTags.length === 0 && <span className="file-card__tag-empty">No tags yet</span>}
                                        {allTags.map((tag) => {
                                            const selectedTag = assignedTagIds.has(tag.id)
                                            return (
                                                <label key={tag.id} className="file-card__tag-option">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTag}
                                                        onChange={() => {
                                                            if (selectedTag) void onRemoveTag?.(item.id, tag.id)
                                                            else void onAddTag?.(item.id, tag.id)
                                                        }}
                                                    />
                                                    <span
                                                        className="file-card__tag-swatch"
                                                        style={{ '--tag-color': tag.color ?? '#38bdf8' } as CSSProperties}
                                                        aria-hidden="true"
                                                    />
                                                    <span>{tag.name}</span>
                                                </label>
                                            )
                                        })}
                                    </div>
                                    <div className="file-card__tag-create">
                                        <input
                                            type="text"
                                            value={tagDraft}
                                            placeholder="New tag"
                                            onChange={(event) => setTagDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    void saveTagDraft()
                                                }
                                            }}
                                        />
                                        <button type="button" onClick={() => void saveTagDraft()} disabled={tagSaving || !tagDraft.trim()}>
                                            Add
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {hasAction && (
                <FileCardActions
                    item={item}
                    view={view}
                    isRenaming={isRenaming}
                    renameSaving={renameSaving}
                    canRename={canRename}
                    canPreview={canPreview}
                    canDownload={canDownload}
                    canShare={canShare}
                    canNote={canNote}
                    isInfoOpen={isInfoOpen}
                    infoPopover={
                        isInfoOpen ? (
                            <FileInfoPopover
                                item={item}
                                view={view}
                                typeLabel={typeLabel}
                                position={infoPosition}
                                onClose={() => setIsInfoOpen(false)}
                                onRestoreVersion={onRestoreVersion ? (versionId) => onRestoreVersion(item, versionId) : undefined}
                            />
                        ) : null
                    }
                    onSaveRename={() => void saveRename()}
                    onCancelRename={cancelRename}
                    onStartRename={() => {
                        setRenameDraft(item.filename)
                        setIsRenaming(true)
                        selectFilenameWithoutExtension(item.filename)
                    }}
                    onToggleInfo={() => {
                        if (!isInfoOpen) scheduleInfoPositionUpdate()
                        setIsInfoOpen((current) => !current)
                    }}
                    onPreview={onPreview}
                    onDownload={onDownload}
                    onShare={onShare}
                    onNote={onNote}
                    onMove={canMove ? onMove : undefined}
                    onDelete={onDelete}
                    onRestore={onRestore}
                    onPermanentDelete={onPermanentDelete}
                />
            )}
        </article>
    )
}
