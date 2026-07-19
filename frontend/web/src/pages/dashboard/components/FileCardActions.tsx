import type { ReactNode } from 'react'
import {
    CANCEL_ICON,
    CHECK_ICON,
    DOWNLOAD_ICON,
    INFO_ICON,
    NOTE_ICON,
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
    canDownload: boolean
    canShare: boolean
    canNote: boolean
    isInfoOpen: boolean
    infoPopover: ReactNode
    onSaveRename: () => void
    onCancelRename: () => void
    onStartRename: () => void
    onToggleInfo: () => void
    onDownload?: ((item: Item) => void) | undefined
    onShare?: ((item: Item) => void | Promise<void>) | undefined
    onNote?: ((item: Item) => void) | undefined
    onDelete?: ((id: string) => void) | undefined
    onRestore?: ((id: string) => void) | undefined
    onPermanentDelete?: ((id: string) => void) | undefined
}

export function FileCardActions({
    item,
    view,
    isRenaming,
    renameSaving,
    canRename,
    canDownload,
    canShare,
    canNote,
    isInfoOpen,
    infoPopover,
    onSaveRename,
    onCancelRename,
    onStartRename,
    onToggleInfo,
    onDownload,
    onShare,
    onNote,
    onDelete,
    onRestore,
    onPermanentDelete,
}: FileCardActionsProps) {
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
            {canRename && !isRenaming && (
                <button
                    className="file-card__action file-card__action--rename"
                    onClick={(e) => {
                        e.stopPropagation()
                        onStartRename()
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
            {canShare && (
                <button
                    className={`file-card__action file-card__action--share ${item.is_public ? 'is-active' : ''}`}
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
            {canNote && (
                <button
                    className={`file-card__action file-card__action--note ${item.note ? 'is-active' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation()
                        onNote?.(item)
                    }}
                    aria-label={`${item.note ? 'Edit' : 'Add'} note for ${item.filename}`}
                    aria-pressed={Boolean(item.note)}
                    title={item.note ? 'Edit note' : 'Add note'}
                    type="button"
                >
                    {NOTE_ICON}
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
                    type="button"
                >
                    Restore
                </button>
            )}
            {view === 'trash' && onPermanentDelete && (
                <button
                    className="file-card__action file-card__action--trash"
                    onClick={(e) => {
                        e.stopPropagation()
                        onPermanentDelete(item.id)
                    }}
                    aria-label={`Permanently delete ${item.filename}`}
                    title="Delete forever"
                    type="button"
                >
                    {TRASH_OPEN_ICON}
                </button>
            )}
        </div>
    )
}
