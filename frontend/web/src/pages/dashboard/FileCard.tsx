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
import { DRAG_HANDLE_ICON, STAR_ICON_FILLED, STAR_ICON_OUTLINE } from './icons'
import type { Item, ViewKey } from './types'
import { KIND_LABELS, formatBytes, formatRelative, kindFromFile, useDecryptReveal } from './fileUtils'
import { isShared } from './fileCardUtils'

export function FileCard({
                      item,
                      index,
                      pending,
                      onDelete,
                      onRestore,
                      onPermanentDelete,
                      onDownload,
                      onPreview,
                      onRename,
                      onShare,
                      onNote,
                      view,
                      isFavourite,
                      onToggleFavourite,
                      draggable,
                      isDragging,
                      isDropTarget,
                      isSearchExiting,
                      style,
                      onDragStartCard,
                      onDragEnterCard,
                      onDragLeaveCard,
                      onDropCard,
                      onDragEndCard,
                  }: {
    item: Item
    index: number
    pending: boolean
    onDelete?: (id: string) => void
    onRestore?: (id: string) => void
    onPermanentDelete?: (id: string) => void
    onDownload?: (item: Item) => void
    onPreview?: (item: Item) => void
    onRename?: (item: Item, filename: string) => Promise<void>
    onShare?: (item: Item) => void | Promise<void>
    onNote?: (item: Item) => void
    view: ViewKey
    isFavourite?: boolean
    onToggleFavourite?: (id: string) => void | Promise<void>
    draggable?: boolean
    isDragging?: boolean
    isDropTarget?: boolean
    isSearchExiting?: boolean
    style?: CSSProperties
    onDragStartCard?: (id: string, e: DragEvent<HTMLElement>) => void
    onDragEnterCard?: (id: string) => void
    onDragLeaveCard?: (id: string) => void
    onDropCard?: (id: string, e: DragEvent<HTMLElement>) => void
    onDragEndCard?: () => void
}) {
    const display = useDecryptReveal(item.filename, index * 60)
    const kind = kindFromFile(item.filename, item.mime_type)
    const typeLabel = KIND_LABELS[kind]
    const [favouriteTouched, setFavouriteTouched] = useState(false)
    const [isRenaming, setIsRenaming] = useState(false)
    const [isInfoOpen, setIsInfoOpen] = useState(false)
    const [infoPosition, setInfoPosition] = useState<InfoPopoverPosition>({ left: 14, top: 14 })
    const [renameDraft, setRenameDraft] = useState(item.filename)
    const [renameSaving, setRenameSaving] = useState(false)
    const renameInputRef = useRef<HTMLInputElement>(null)
    const cardRef = useRef<HTMLElement>(null)
    const canToggleFavourite = Boolean(onToggleFavourite && !isShared(item))
    const canRename = Boolean(onRename && !isShared(item) && view !== 'trash' && !pending)
    const canShare = Boolean(onShare && !isShared(item) && view !== 'trash' && !pending)
    const canNote = Boolean(onNote && !isShared(item) && view !== 'trash' && !pending)
    const canDownload = Boolean(onDownload && view !== 'trash')
    const canPreview = Boolean(onPreview && ['image', 'video', 'pdf', 'text', 'code'].includes(kind) && view !== 'trash' && !pending && !isRenaming)
    const hasAction = Boolean(
        canRename ||
            canShare ||
            canNote ||
            canDownload ||
            (view === 'all' && onDelete) ||
            (view === 'trash' && (onRestore || onPermanentDelete)) ||
            !isRenaming,
    )

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

        updateInfoPosition()
        window.addEventListener('resize', updateInfoPosition)
        window.addEventListener('scroll', updateInfoPosition, true)
        return () => {
            window.removeEventListener('resize', updateInfoPosition)
            window.removeEventListener('scroll', updateInfoPosition, true)
        }
    }, [isInfoOpen, updateInfoPosition])

    const handlePreviewKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        if (!canPreview) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onPreview?.(item)
    }
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

    return (
        <article
            ref={cardRef}
            className={`file-card ${canPreview ? 'file-card--can-preview' : ''} ${
                canToggleFavourite ? 'file-card--has-favourite' : ''
            } ${
                hasAction ? 'file-card--has-action' : ''
            } ${isDragging ? 'is-dragging-card' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${
                isSearchExiting ? 'is-search-exiting' : ''
            }`}
            style={style}
            draggable={draggable && !pending && !isRenaming}
            role={canPreview ? 'button' : undefined}
            tabIndex={canPreview ? 0 : undefined}
            aria-label={canPreview ? `Preview ${item.filename}` : undefined}
            onClick={canPreview ? () => onPreview?.(item) : undefined}
            onKeyDown={handlePreviewKeyDown}
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
            {draggable && !pending && (
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
            <FileCardHeader item={item} kind={kind} pending={pending} />
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
            <p className="file-card__meta">
                {typeLabel} · {formatBytes(item.size_bytes)} · {formatRelative(item.updated_at)}
                {isShared(item) && item.shared_by_user_name ? ` · shared by ${item.shared_by_user_name}` : ''}
            </p>
            {hasAction && (
                <FileCardActions
                    item={item}
                    view={view}
                    isRenaming={isRenaming}
                    renameSaving={renameSaving}
                    canRename={canRename}
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
                        if (!isInfoOpen) updateInfoPosition()
                        setIsInfoOpen((current) => !current)
                    }}
                    onDownload={onDownload}
                    onShare={onShare}
                    onNote={onNote}
                    onDelete={onDelete}
                    onRestore={onRestore}
                    onPermanentDelete={onPermanentDelete}
                />
            )}
        </article>
    )
}


