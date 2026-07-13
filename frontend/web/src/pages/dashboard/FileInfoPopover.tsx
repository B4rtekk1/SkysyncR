import { createPortal } from 'react-dom'
import { CANCEL_ICON } from './icons'
import {
    formatDateTime,
    formatExactBytes,
    formatPermission,
    formatSource,
    isShared,
} from './fileCardUtils'
import type { Item, ViewKey } from './types'

export type InfoPopoverPosition = {
    left: number
    top: number
}

type FileInfoPopoverProps = {
    item: Item
    view: ViewKey
    typeLabel: string
    position: InfoPopoverPosition
    onClose: () => void
}

export function FileInfoPopover({ item, view, typeLabel, position, onClose }: FileInfoPopoverProps) {
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
        ['Note', item.note ? item.note : 'No note attached'],
        ['Sharing', item.is_public ? 'Public link enabled' : 'Not public'],
        ...(isShared(item) ? [['Shared by', item.shared_by_user_name || item.shared_by_user_id]] : []),
        ['File ID', item.id],
    ]

    return createPortal(
        <div
            className="file-card__info-backdrop"
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose()
            }}
            role="presentation"
        >
            <div
                className="file-card__info-popover"
                style={{ left: position.left, top: position.top }}
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
                            onClose()
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
}
