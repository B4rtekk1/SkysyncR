import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CANCEL_ICON } from '../icons'
import {
    formatDateTime,
    formatExactBytes,
    formatPermission,
    formatSource,
    isShared,
} from '../fileCardUtils'
import type { Item, ViewKey } from '../types'
import {
    listFileActivity,
    listFileVersions,
    type ApiFolder,
    type FileAudit,
    type FileVersion,
} from '../../../api/files'

export type InfoPopoverPosition = {
    left: number
    top: number
}

type FileInfoPopoverProps = {
    item: Item | ApiFolder
    view?: ViewKey
    typeLabel?: string
    position: InfoPopoverPosition
    onClose: () => void
    onRestoreVersion?: ((versionId: string) => unknown | Promise<unknown>) | undefined
}

export function FileInfoPopover({ item, view, typeLabel, position, onClose, onRestoreVersion }: FileInfoPopoverProps) {
    const isFolder = !('filename' in item)
    const [versions, setVersions] = useState<FileVersion[]>([])
    const [activity, setActivity] = useState<FileAudit[]>([])
    const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'error'>('idle')
    const [restorePendingId, setRestorePendingId] = useState<string | null>(null)
    const title = isFolder ? item.name : item.filename
    const infoRows = isFolder
        ? [
              ['Name', item.name],
              ['Description', item.description || 'No description set'],
              ['Files', item.file_count === 1 ? '1 file' : `${item.file_count} files`],
              ['Created', formatDateTime(item.created_at)],
              ['Modified', formatDateTime(item.updated_at)],
              ...(item.deleted_at ? [['Deleted', formatDateTime(item.deleted_at)]] : []),
              ['Parent folder', item.parent_folder_id || 'Root'],
              ['Sharing', item.is_public ? 'Public link enabled' : 'Not public'],
              ['Folder ID', item.id],
          ]
        : [
              ['Name', item.filename],
              ['Exact size', formatExactBytes(item.size_bytes)],
              ['Type', typeLabel ?? 'Unknown'],
              ['MIME type', item.mime_type || 'Unknown'],
              ['Created', formatDateTime(item.created_at)],
              ['Modified', formatDateTime(item.updated_at)],
              ...(item.deleted_at ? [['Deleted', formatDateTime(item.deleted_at)]] : []),
              ['Permissions', formatPermission(item)],
              ['Source', formatSource(item, view ?? 'all')],
              ['Folder', item.folder_id || 'Root'],
              ['Note', item.note ? item.note : 'No note attached'],
              ['Sharing', item.is_public ? 'Public link enabled' : 'Not public'],
              ...(isShared(item) ? [['Shared by', item.shared_by_user_name || item.shared_by_user_id]] : []),
              ['File ID', item.id],
          ]

    useEffect(() => {
        if (isFolder) return

        let active = true
        setHistoryStatus('loading')
        Promise.all([listFileVersions(item.id), listFileActivity(item.id)])
            .then(([nextVersions, nextActivity]) => {
                if (!active) return
                setVersions(nextVersions)
                setActivity(nextActivity)
                setHistoryStatus('idle')
            })
            .catch(() => {
                if (!active) return
                setHistoryStatus('error')
            })

        return () => {
            active = false
        }
    }, [isFolder, item.id])

    async function restoreVersion(versionId: string) {
        if (!onRestoreVersion || restorePendingId) return

        setRestorePendingId(versionId)
        try {
            await onRestoreVersion(versionId)
            const [nextVersions, nextActivity] = await Promise.all([
                listFileVersions(item.id),
                listFileActivity(item.id),
            ])
            setVersions(nextVersions)
            setActivity(nextActivity)
        } finally {
            setRestorePendingId(null)
        }
    }

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
                aria-label={`Details for ${title}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="file-card__info-head">
                    <span>{isFolder ? 'Folder details' : 'File details'}</span>
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
                {!isFolder && (
                    <div className="file-card__history" aria-label={`Change history for ${title}`}>
                        <section className="file-card__history-section">
                            <h3>Versions</h3>
                            {historyStatus === 'loading' && <p className="file-card__history-muted">Loading history...</p>}
                            {historyStatus === 'error' && <p className="file-card__history-muted">Could not load history.</p>}
                            {historyStatus !== 'loading' && versions.length === 0 && (
                                <p className="file-card__history-muted">No previous versions yet.</p>
                            )}
                            {versions.map((version) => (
                                <div className="file-card__history-row" key={version.id}>
                                    <div>
                                        <strong>Version {version.version_number}</strong>
                                        <span>
                                            {formatDateTime(version.created_at)} · {formatExactBytes(version.size_bytes)}
                                        </span>
                                        <span>{version.device_label || 'Unknown device'}</span>
                                    </div>
                                    {onRestoreVersion && (
                                        <button
                                            type="button"
                                            onClick={() => void restoreVersion(version.id)}
                                            disabled={restorePendingId !== null}
                                        >
                                            {restorePendingId === version.id ? 'Restoring...' : 'Restore'}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </section>
                        <section className="file-card__history-section">
                            <h3>Activity</h3>
                            {activity.length === 0 && historyStatus !== 'loading' && (
                                <p className="file-card__history-muted">No activity recorded yet.</p>
                            )}
                            {activity.map((event) => (
                                <div className="file-card__history-row file-card__history-row--activity" key={event.id}>
                                    <div>
                                        <strong>{formatAction(event.action)}</strong>
                                        <span>{formatDateTime(event.created_at)}</span>
                                        <span>{event.device_label || 'Unknown device'}</span>
                                    </div>
                                </div>
                            ))}
                        </section>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    )
}

function formatAction(action: string) {
    return action
        .replace(/^file\./, '')
        .replace(/\./g, ' ')
        .replace(/^\w/, (letter) => letter.toUpperCase())
}
