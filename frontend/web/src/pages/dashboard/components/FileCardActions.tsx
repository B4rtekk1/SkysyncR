import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
    CANCEL_ICON,
    CHECK_ICON,
    DOWNLOAD_ICON,
    INFO_ICON,
    MORE_ICON,
    NOTE_ICON,
    PREVIEW_ICON,
    RENAME_ICON,
    SHARE_ICON,
    TRASH_OPEN_ICON,
} from '../icons'
import type { Item, ViewKey } from '../types'

type FileCardActionsProps = {
    item: Item
    view: ViewKey
    isRenaming: boolean
    renameSaving: boolean
    canRename: boolean
    canPreview: boolean
    canDownload: boolean
    canShare: boolean
    canNote: boolean
    isInfoOpen: boolean
    infoPopover: ReactNode
    onSaveRename: () => void
    onCancelRename: () => void
    onStartRename: () => void
    onToggleInfo: () => void
    onPreview?: ((item: Item) => void) | undefined
    onDownload?: ((item: Item) => void) | undefined
    onShare?: ((item: Item) => void | Promise<void>) | undefined
    onNote?: ((item: Item) => void) | undefined
    onDelete?: ((id: string) => void) | undefined
    onRestore?: ((id: string) => void) | undefined
    onPermanentDelete?: ((id: string) => void) | undefined
}

type MenuAction = {
    key: string
    label: string
    icon?: ReactNode
    danger?: boolean
    active?: boolean
    onSelect: () => void
}

export function FileCardActions({
    item,
    view,
    isRenaming,
    renameSaving,
    canRename,
    canPreview,
    canDownload,
    canShare,
    canNote,
    isInfoOpen,
    infoPopover,
    onSaveRename,
    onCancelRename,
    onStartRename,
    onToggleInfo,
    onPreview,
    onDownload,
    onShare,
    onNote,
    onDelete,
    onRestore,
    onPermanentDelete,
}: FileCardActionsProps) {
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const secondaryActions: MenuAction[] = []

    if (canRename && !isRenaming) {
        secondaryActions.push({
            key: 'rename',
            label: 'Rename',
            icon: RENAME_ICON,
            onSelect: onStartRename,
        })
    }

    if (canShare) {
        secondaryActions.push({
            key: 'share',
            label: item.is_public ? 'Manage share' : 'Share',
            icon: SHARE_ICON,
            active: item.is_public,
            onSelect: () => void onShare?.(item),
        })
    }

    if (canNote) {
        secondaryActions.push({
            key: 'note',
            label: item.note ? 'Edit note' : 'Add note',
            icon: NOTE_ICON,
            active: Boolean(item.note),
            onSelect: () => onNote?.(item),
        })
    }

    if (view === 'all' && onDelete) {
        secondaryActions.push({
            key: 'trash',
            label: 'Move to trash',
            icon: TRASH_OPEN_ICON,
            danger: true,
            onSelect: () => onDelete(item.id),
        })
    }

    if (view === 'trash' && onRestore) {
        secondaryActions.push({
            key: 'restore',
            label: 'Restore',
            onSelect: () => onRestore(item.id),
        })
    }

    if (view === 'trash' && onPermanentDelete) {
        secondaryActions.push({
            key: 'delete-forever',
            label: 'Delete forever',
            icon: TRASH_OPEN_ICON,
            danger: true,
            onSelect: () => onPermanentDelete(item.id),
        })
    }

    useEffect(() => {
        if (!menuOpen) return

        function closeOnOutsideClick(e: MouseEvent) {
            if (menuRef.current?.contains(e.target as Node)) return
            setMenuOpen(false)
        }

        function closeOnEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') setMenuOpen(false)
        }

        document.addEventListener('mousedown', closeOnOutsideClick)
        window.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick)
            window.removeEventListener('keydown', closeOnEscape)
        }
    }, [menuOpen])

    return (
        <div className="file-card__actions">
            {isRenaming && (
                <>
                    <button
                        className="file-card__action file-card__action--confirm"
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onSaveRename()
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
                            onCancelRename()
                        }}
                        disabled={renameSaving}
                        aria-label={`Cancel rename for ${item.filename}`}
                        title="Cancel"
                    >
                        {CANCEL_ICON}
                    </button>
                </>
            )}

            {canPreview && (
                <button
                    className="file-card__action file-card__action--preview"
                    onClick={(e) => {
                        e.stopPropagation()
                        onPreview?.(item)
                    }}
                    aria-label={`Preview ${item.filename}`}
                    title="Preview"
                    type="button"
                >
                    {PREVIEW_ICON}
                </button>
            )}

            {!isRenaming && (
                <div className="file-card__info-wrap">
                    <button
                        className={`file-card__action file-card__action--info ${isInfoOpen ? 'is-active' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation()
                            onToggleInfo()
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

            {!isRenaming && secondaryActions.length > 0 && (
                <div className="file-card__more" ref={menuRef}>
                    <button
                        className={`file-card__action file-card__action--more ${menuOpen ? 'is-active' : ''}`}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            setMenuOpen((open) => !open)
                        }}
                        aria-label={`More actions for ${item.filename}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        title="More actions"
                    >
                        {MORE_ICON}
                    </button>
                    {menuOpen && (
                        <div className="file-card__more-menu" role="menu" aria-label={`More actions for ${item.filename}`}>
                            {secondaryActions.map((action) => (
                                <button
                                    key={action.key}
                                    className={`file-card__more-item ${action.danger ? 'is-danger' : ''} ${action.active ? 'is-active' : ''}`}
                                    type="button"
                                    role="menuitem"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setMenuOpen(false)
                                        action.onSelect()
                                    }}
                                >
                                    {action.icon && <span className="file-card__more-icon">{action.icon}</span>}
                                    <span>{action.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
