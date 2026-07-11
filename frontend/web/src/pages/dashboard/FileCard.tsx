import { useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SharedFile } from '../../api/files'
import { FileIcon } from './FileIcon'
import { DOWNLOAD_ICON, DRAG_HANDLE_ICON, STAR_ICON_FILLED, STAR_ICON_OUTLINE, TRASH_OPEN_ICON } from './icons'
import type { Item, ViewKey } from './types'
import { KIND_LABELS, formatBytes, formatRelative, kindFromFile, useDecryptReveal } from './fileUtils'
function isShared(item: Item): item is SharedFile {
    return 'permission' in item
}

export function FileCard({
                      item,
                      index,
                      pending,
                      onDelete,
                      onRestore,
                      onDownload,
                      onPreview,
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
    onDownload?: (item: Item) => void
    onPreview?: (item: Item) => void
    view: ViewKey
    isFavourite?: boolean
    onToggleFavourite?: (id: string) => void
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
    const canToggleFavourite = Boolean(onToggleFavourite && !isShared(item))
    const canDownload = Boolean(onDownload && view !== 'trash')
    const canPreview = Boolean(onPreview && ['image', 'text', 'code'].includes(kind) && view !== 'trash' && !pending)
    const hasAction = Boolean(canDownload || (view === 'all' && onDelete) || (view === 'trash' && onRestore))
    const handlePreviewKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        if (!canPreview) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onPreview?.(item)
    }

    return (
        <article
            className={`file-card ${canPreview ? 'file-card--can-preview' : ''} ${
                canToggleFavourite ? 'file-card--has-favourite' : ''
            } ${
                hasAction ? 'file-card--has-action' : ''
            } ${isDragging ? 'is-dragging-card' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${
                isSearchExiting ? 'is-search-exiting' : ''
            }`}
            style={style}
            draggable={draggable && !pending}
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
                        onToggleFavourite?.(item.id)
                    }}
                    aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                    aria-pressed={isFavourite}
                    type="button"
                >
                    {isFavourite ? STAR_ICON_FILLED : STAR_ICON_OUTLINE}
                </button>
            )}
            <div className="file-card__top">
                <FileIcon kind={kind} />
                {pending ? (
                    <span className="file-card__badge file-card__badge--pending">
            <span className="spinner" /> Encrypting…
          </span>
                ) : isShared(item) ? (
                    <span className="file-card__badge">{item.permissions === 'write' ? 'Can edit' : 'Can view'}</span>
                ) : (
                    <span className="file-card__badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="10.5" width="14" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            AES-256
          </span>
                )}
            </div>
            <p className="file-card__name" title={item.filename}>
                {display}
            </p>
            <p className="file-card__meta">
                {typeLabel} · {formatBytes(item.size_bytes)} · {formatRelative(item.updated_at)}
                {isShared(item) && item.shared_by_user_name ? ` · shared by ${item.shared_by_user_name}` : ''}
            </p>
            {hasAction && (
                <div className="file-card__actions">
                    {canDownload && (
                        <button
                            className="file-card__action file-card__action--download"
                            onClick={(e) => {
                                e.stopPropagation()
                                onDownload?.(item)
                            }}
                            aria-label={`Download ${item.filename}`}
                            title="Download"
                            type="button"
                        >
                            {DOWNLOAD_ICON}
                        </button>
                    )}
                    {view === 'all' && onDelete && (
                        <button
                            className="file-card__action file-card__action--trash"
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete(item.id)
                            }}
                            aria-label={`Move ${item.filename} to trash`}
                            title="Move to trash"
                            type="button"
                        >
                            {TRASH_OPEN_ICON}
                        </button>
                    )}
                    {view === 'trash' && onRestore && (
                        <button
                            className="file-card__action"
                            onClick={(e) => {
                                e.stopPropagation()
                                onRestore(item.id)
                            }}
                        >
                            Restore
                        </button>
                    )}
                </div>
            )}
        </article>
    )
}


