import {
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type DragEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { SharedFile } from '../../api/files'
import { FileIcon } from './FileIcon'
import { CANCEL_ICON, CHECK_ICON, DOWNLOAD_ICON, DRAG_HANDLE_ICON, INFO_ICON, RENAME_ICON, SHARE_ICON, STAR_ICON_FILLED, STAR_ICON_OUTLINE, TRASH_OPEN_ICON } from './icons'
import type { Item, ViewKey } from './types'
import { KIND_LABELS, formatBytes, formatRelative, kindFromFile, useDecryptReveal } from './fileUtils'
function isShared(item: Item): item is SharedFile {
    return 'permissions' in item
}

function formatExactBytes(bytes: number) {
    return `${new Intl.NumberFormat().format(bytes)} bytes (${formatBytes(bytes)})`
}

function formatDateTime(iso: string | null) {
    if (!iso) return 'Not set'
    return new Date(iso).toLocaleString()
}

function formatPermission(item: Item) {
    if (isShared(item)) {
        if (item.permissions === 'owner') return 'Owner'
        return item.permissions === 'write' ? 'Can edit' : 'Can view'
    }
    return item.is_public ? 'Public link' : 'Private'
}

function formatSource(item: Item, view: ViewKey) {
    if (isShared(item)) {
        return item.shared_by_user_name ? `Shared by ${item.shared_by_user_name}` : `Shared by user ${item.shared_by_user_id}`
    }
    if (view === 'trash') return 'Trash'
    if (view === 'favourites') return 'Favourites'
    return 'My storage'
}

export function FileCard({
                      item,
                      index,
                      pending,
                      onDelete,
                      onRestore,
                      onDownload,
                      onPreview,
                      onRename,
                      onShare,
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
    onRename?: (item: Item, filename: string) => Promise<void>
    onShare?: (item: Item) => void | Promise<void>
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
    const [isRenaming, setIsRenaming] = useState(false)
    const [isInfoOpen, setIsInfoOpen] = useState(false)
    const [renameDraft, setRenameDraft] = useState(item.filename)
    const [renameSaving, setRenameSaving] = useState(false)
    const renameInputRef = useRef<HTMLInputElement>(null)
    const canToggleFavourite = Boolean(onToggleFavourite && !isShared(item))
    const canRename = Boolean(onRename && !isShared(item) && view !== 'trash' && !pending)
    const canShare = Boolean(onShare && !isShared(item) && view !== 'trash' && !pending)
    const canDownload = Boolean(onDownload && view !== 'trash')
    const canPreview = Boolean(onPreview && ['image', 'text', 'code'].includes(kind) && view !== 'trash' && !pending && !isRenaming)
    const hasAction = Boolean(canRename || canShare || canDownload || (view === 'all' && onDelete) || (view === 'trash' && onRestore) || !isRenaming)
    const infoRows = [
        ['Name', item.filename],
        ['Exact size', formatExactBytes(item.size_bytes)],
        ['Type', typeLabel],
        ['MIME type', item.mime_type || 'Unknown'],
        ['Created', formatDateTime(item.created_at)],
        ['Modified', formatDateTime(item.updated_at)],
        ...(item.deleted_at ? [['Deleted', formatDateTime(item.deleted_at)]] : []),
        ['Permissions', formatPermission(item)],
        ['Source', formatSource(item, view)],
        ['Folder', item.folder_id || 'Root'],
        ['Sharing', item.is_public ? 'Public link enabled' : 'Not public'],
        ...(isShared(item) ? [['Shared by', item.shared_by_user_name || item.shared_by_user_id]] : []),
        ['File ID', item.id],
    ]

    useEffect(() => {
        if (!isInfoOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsInfoOpen(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isInfoOpen])

    const infoPopover = isInfoOpen
        ? createPortal(
              <div
                  className="file-card__info-backdrop"
                  onClick={() => setIsInfoOpen(false)}
                  role="presentation"
              >
                  <div
                      className="file-card__info-popover"
                      role="dialog"
                      aria-label={`Details for ${item.filename}`}
                      onClick={(e) => e.stopPropagation()}
                  >
                      <div className="file-card__info-head">
                          <span>File details</span>
                          <button
                              type="button"
                              onClick={(e) => {
                                  e.stopPropagation()
                                  setIsInfoOpen(false)
                              }}
                              aria-label="Close details"
                          >
                              {CANCEL_ICON}
                          </button>
                      </div>
                      <dl className="file-card__info-list">
                          {infoRows.map(([label, value]) => (
                              <div className="file-card__info-row" key={label}>
                                  <dt>{label}</dt>
                                  <dd>{value}</dd>
                              </div>
                          ))}
                      </dl>
                  </div>
              </div>,
              document.body,
          )
        : null

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
            <div className="file-card__name-slot">
                {isRenaming ? (
                    <input
                        className="file-card__rename-input"
                        type="text"
                        value={renameDraft}
                        ref={renameInputRef}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelRename()
                            } else if (e.key === 'Enter') {
                                e.preventDefault()
                                void saveRename()
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={renameSaving}
                        aria-label={`Rename ${item.filename}`}
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
                <div className="file-card__actions">
                    {isRenaming && (
                        <>
                            <button
                                className="file-card__action file-card__action--confirm"
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    void saveRename()
                                }}
                                disabled={renameSaving}
                                aria-label={`Save name for ${item.filename}`}
                                title="Save name"
                            >
                                {CHECK_ICON}
                            </button>
                            <button
                                className="file-card__action file-card__action--cancel"
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    cancelRename()
                                }}
                                disabled={renameSaving}
                                aria-label={`Cancel rename for ${item.filename}`}
                                title="Cancel"
                            >
                                {CANCEL_ICON}
                            </button>
                        </>
                    )}
                    {canRename && !isRenaming && (
                        <button
                            className="file-card__action file-card__action--rename"
                            onClick={(e) => {
                                e.stopPropagation()
                                setRenameDraft(item.filename)
                                setIsRenaming(true)
                                selectFilenameWithoutExtension(item.filename)
                            }}
                            aria-label={`Rename ${item.filename}`}
                            title="Rename"
                            type="button"
                        >
                            {RENAME_ICON}
                        </button>
                    )}
                    {!isRenaming && (
                        <div className="file-card__info-wrap">
                            <button
                                className={`file-card__action file-card__action--info ${
                                    isInfoOpen ? 'is-active' : ''
                                }`}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setIsInfoOpen((current) => !current)
                                }}
                                aria-label={`Show details for ${item.filename}`}
                                aria-expanded={isInfoOpen}
                                title="Details"
                                type="button"
                            >
                                {INFO_ICON}
                            </button>
                            {infoPopover}
                        </div>
                    )}
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
                    {canShare && (
                        <button
                            className={`file-card__action file-card__action--share ${
                                item.is_public ? 'is-active' : ''
                            }`}
                            onClick={(e) => {
                                e.stopPropagation()
                                void onShare?.(item)
                            }}
                            aria-label={`Share ${item.filename}`}
                            aria-pressed={item.is_public}
                            title="Share"
                            type="button"
                        >
                            {SHARE_ICON}
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


