import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ApiFile, ApiFolder, SharedFile } from '../../../api/files'
import type { FileTag, Tag } from '../../../api/tags'
import { getOperationLog, type OperationLogEntry } from '../../../api/users'
import { FileCard } from './FileCard'
import type { UploadTransfer } from '../hooks/useFileUpload'
import { formatBytes, formatRelative } from '../fileUtils'
import type { GroupIncomingInvite, Item } from '../types'

type RecentImportantPanelProps = {
    items: Item[]
    files: ApiFile[]
    folders: ApiFolder[]
    incomingGroupInvites: GroupIncomingInvite[]
    pendingIds: Set<string>
    uploadTransfers: UploadTransfer[]
    favouriteIds: Set<string>
    tags: Tag[]
    fileTagsByFileId: Map<string, FileTag[]>
    onDelete: (id: string) => void | Promise<void>
    onRestoreVersion: (item: Item, versionId: string) => unknown | Promise<unknown>
    onPreview: (item: Item) => void | Promise<void>
    onDownload: (item: Item) => void | Promise<void>
    onRename: (item: Item, filename: string) => Promise<void>
    onShare: (item: Item) => void | Promise<void>
    onNote: (item: Item) => void
    onRemind: (item: Item) => void | Promise<void>
    onMoveFile: (item: Item) => void | Promise<void>
    onToggleFavourite: (id: string) => void | Promise<void>
    onCreateTag: (name: string) => Promise<Tag | null>
    onAddTagToFile: (fileId: string, tagId: string) => void | Promise<void>
    onRemoveTagFromFile: (fileId: string, tagId: string) => void | Promise<void>
    onAcceptInvite: (inviteId: string) => void
    onDeclineInvite: (inviteId: string) => void
    onBlockFileLink: (file: ApiFile) => Promise<void>
    onBlockFolderLink: (folder: ApiFolder) => Promise<void>
}

type PublicLinkAlert =
    | { kind: 'file'; id: string; name: string; detail: string; updatedAt: string; expiresAt: string | null; file: ApiFile }
    | { kind: 'folder'; id: string; name: string; detail: string; updatedAt: string; expiresAt: string | null; folder: ApiFolder }

const riskyOperations = new Set([
    'file.share',
    'file.update',
    'file.version.restore',
    'user.password.change',
    'user.logout_all',
    'user.session.revoke',
])

const operationLabels: Record<string, string> = {
    'file.share': 'Changed public access',
    'file.update': 'Updated file contents',
    'file.version.restore': 'Restored file version',
    'user.password.change': 'Changed password',
    'user.logout_all': 'Signed out everywhere',
    'user.session.revoke': 'Signed out device',
}

function isSharedFile(item: Item): item is SharedFile {
    return 'permissions' in item
}

function sortByUpdatedAt<T extends { updated_at: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
}

function formatDateTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown time'
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date)
}

function formatExpiry(value: string | null, nowMs: number): string {
    if (!value) return 'No expiration date'
    const expiry = new Date(value)
    if (Number.isNaN(expiry.getTime())) return 'Invalid expiration date'
    const diffMs = expiry.getTime() - nowMs
    if (diffMs <= 0) return 'Expired'
    const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000))
    if (days === 1) return 'Expires tomorrow'
    return `Expires in ${days} days`
}

function toPublicLinkAlerts(files: ApiFile[], folders: ApiFolder[], nowMs: number): PublicLinkAlert[] {
    const publicFiles = files
        .filter((file) => file.is_public && file.share_token && !file.is_deleted)
        .map((file): PublicLinkAlert => ({
            kind: 'file',
            id: file.id,
            name: file.filename,
            detail: `${formatExpiry(file.share_expires_at, nowMs)} · ${formatBytes(file.size_bytes)} · ${file.share_download_count}/${file.share_download_limit ?? 'unlimited'} downloads`,
            updatedAt: file.updated_at,
            expiresAt: file.share_expires_at,
            file,
        }))
    const publicFolders = folders
        .filter((folder) => folder.is_public && folder.share_token && !folder.is_deleted)
        .map((folder): PublicLinkAlert => ({
            kind: 'folder',
            id: folder.id,
            name: folder.name,
            detail: `${formatExpiry(folder.share_expires_at, nowMs)} · Public folder link`,
            updatedAt: folder.updated_at,
            expiresAt: folder.share_expires_at,
            folder,
        }))

    return [...publicFiles, ...publicFolders].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5)
}

function toExpiringLinkAlerts(files: ApiFile[], folders: ApiFolder[], nowMs: number): PublicLinkAlert[] {
    const sevenDaysFromNow = nowMs + 7 * 24 * 60 * 60 * 1000
    return toPublicLinkAlerts(files, folders, nowMs)
        .filter((alert) => {
            if (!alert.expiresAt) return false
            const expiry = new Date(alert.expiresAt).getTime()
            return !Number.isNaN(expiry) && expiry <= sevenDaysFromNow
        })
        .sort((a, b) => {
            const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
            const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
            return aTime - bTime
        })
}

function toSecurityOperations(operations: OperationLogEntry[], files: ApiFile[]): OperationLogEntry[] {
    const favouriteFileIds = new Set(files.filter((file) => file.is_favourite).map((file) => file.id))
    const now = Date.now()
    const recentDeletes = operations.filter((entry) => entry.operation === 'file.delete' && now - new Date(entry.created_at).getTime() < 30 * 60 * 1000)
    const recentUpdates = operations.filter((entry) => entry.operation === 'file.update' && now - new Date(entry.created_at).getTime() < 30 * 60 * 1000)
    const massActivityIds = new Set<string>()

    if (recentDeletes.length >= 5) recentDeletes.forEach((entry) => massActivityIds.add(entry.id))
    if (recentUpdates.length >= 10) recentUpdates.forEach((entry) => massActivityIds.add(entry.id))

    return operations
        .filter(
            (entry) =>
                riskyOperations.has(entry.operation) ||
                massActivityIds.has(entry.id) ||
                (entry.operation === 'file.delete' && entry.resource_id !== null && favouriteFileIds.has(entry.resource_id)),
        )
        .slice(0, 5)
}

export function RecentImportantPanel({
    items,
    files,
    folders,
    incomingGroupInvites,
    pendingIds,
    uploadTransfers,
    favouriteIds,
    tags,
    fileTagsByFileId,
    onDelete,
    onRestoreVersion,
    onPreview,
    onDownload,
    onRename,
    onShare,
    onNote,
    onRemind,
    onMoveFile,
    onToggleFavourite,
    onCreateTag,
    onAddTagToFile,
    onRemoveTagFromFile,
    onAcceptInvite,
    onDeclineInvite,
    onBlockFileLink,
    onBlockFolderLink,
}: RecentImportantPanelProps) {
    const [operationLog, setOperationLog] = useState<OperationLogEntry[]>([])
    const [securityLoading, setSecurityLoading] = useState(true)
    const [securityError, setSecurityError] = useState<string | null>(null)
    const [blockingLinkId, setBlockingLinkId] = useState<string | null>(null)
    const [nowMs] = useState(() => Date.now())

    const recentFiles = useMemo(() => sortByUpdatedAt(items).slice(0, 6), [items])
    const sharedFiles = useMemo(() => sortByUpdatedAt(items.filter(isSharedFile)).slice(0, 5), [items])
    const publicLinkAlerts = useMemo(() => toPublicLinkAlerts(files, folders, nowMs), [files, folders, nowMs])
    const expiringLinkAlerts = useMemo(() => toExpiringLinkAlerts(files, folders, nowMs), [files, folders, nowMs])
    const expiredLinkAlerts = useMemo(
        () => expiringLinkAlerts.filter((alert) => alert.expiresAt && new Date(alert.expiresAt).getTime() <= nowMs),
        [expiringLinkAlerts, nowMs],
    )
    const securityOperations = useMemo(() => toSecurityOperations(operationLog, files), [files, operationLog])
    const transferStatusByTempId = useMemo(
        () => new Map(uploadTransfers.map((transfer) => [transfer.tempId, transfer.status])),
        [uploadTransfers],
    )
    const securityAlertCount = publicLinkAlerts.length + securityOperations.length
    const attentionCount = incomingGroupInvites.length + securityAlertCount
    const attentionStatus = securityLoading ? 'Checking' : attentionCount === 0 ? 'Clear' : `${attentionCount} items`

    const blockPublicLink = useCallback(async (alert: PublicLinkAlert) => {
        setBlockingLinkId(alert.id)
        try {
            if (alert.kind === 'file') await onBlockFileLink(alert.file)
            else await onBlockFolderLink(alert.folder)
        } finally {
            setBlockingLinkId(null)
        }
    }, [onBlockFileLink, onBlockFolderLink])

    useEffect(() => {
        let active = true

        async function loadOperations() {
            setSecurityLoading(true)
            setSecurityError(null)
            try {
                const data = await getOperationLog()
                if (active) setOperationLog(data.operations)
            } catch {
                if (active) setSecurityError('Could not load security alerts.')
            } finally {
                if (active) setSecurityLoading(false)
            }
        }

        void loadOperations()
        return () => {
            active = false
        }
    }, [])

    useEffect(() => {
        if (expiredLinkAlerts.length === 0) return
        let active = true

        async function revokeExpiredLinks() {
            for (const alert of expiredLinkAlerts) {
                if (!active) return
                await blockPublicLink(alert)
            }
        }

        void revokeExpiredLinks()
        return () => {
            active = false
        }
    }, [blockPublicLink, expiredLinkAlerts])

    return (
        <div className="recent-important">
            <section className={`recent-important__overview ${attentionCount > 0 ? 'has-attention' : 'is-clear'}`}>
                <div className="recent-important__overview-main">
                    <span>Needs attention</span>
                    <strong>{attentionStatus}</strong>
                    <p>
                        {securityLoading
                            ? 'Reviewing invitations, public links, and recent security activity.'
                            : attentionCount > 0
                              ? 'Invitations and security items are ready for review.'
                              : 'No invitations or security alerts need action right now.'}
                    </p>
                </div>

                <div className="recent-important__attention-summary">
                    <div>
                        <span>Invites</span>
                        <strong>{incomingGroupInvites.length}</strong>
                    </div>
                    <div>
                        <span>Security</span>
                        <strong>{securityLoading ? '-' : securityAlertCount}</strong>
                    </div>
                </div>
            </section>

            <section className="recent-important__metrics" aria-label="Recent and important summary">
                <div className="recent-important__metric recent-important__metric--files">
                    <span>Recent files</span>
                    <strong>{recentFiles.length}</strong>
                </div>
                <div className="recent-important__metric recent-important__metric--shared">
                    <span>Shared with me</span>
                    <strong>{sharedFiles.length}</strong>
                </div>
                <div className="recent-important__metric recent-important__metric--invites">
                    <span>Pending invites</span>
                    <strong>{incomingGroupInvites.length}</strong>
                </div>
                <div className="recent-important__metric recent-important__metric--security">
                    <span>Security alerts</span>
                    <strong>{securityLoading ? '-' : securityAlertCount}</strong>
                </div>
                <div className="recent-important__metric recent-important__metric--expiry">
                    <span>Expiring links</span>
                    <strong>{expiringLinkAlerts.length}</strong>
                </div>
            </section>

            <div className="recent-important__layout">
                <section className="recent-important__panel recent-important__panel--wide">
                    <div className="recent-important__head">
                        <span>Activity</span>
                        <h2>Recently opened files</h2>
                    </div>
                    <div className="file-grid file-grid--grid recent-important__file-grid">
                        {recentFiles.length === 0 && <p className="recent-important__empty">No recent files are visible in this vault snapshot.</p>}
                        {recentFiles.map((item, index) => (
                            <FileCard
                                key={item.id}
                                item={item}
                                index={index}
                                pending={pendingIds.has(item.id)}
                                transferStatus={transferStatusByTempId.get(item.id)}
                                view="all"
                                onDelete={onDelete}
                                onRestoreVersion={onRestoreVersion}
                                onDownload={onDownload}
                                onPreview={onPreview}
                                onRename={onRename}
                                onShare={onShare}
                                onNote={onNote}
                                onRemind={onRemind}
                                onMove={onMoveFile}
                                isFavourite={favouriteIds.has(item.id)}
                                onToggleFavourite={onToggleFavourite}
                                tags={fileTagsByFileId.get(item.id) ?? []}
                                allTags={tags}
                                onCreateTag={onCreateTag}
                                onAddTag={onAddTagToFile}
                                onRemoveTag={onRemoveTagFromFile}
                                draggable={false}
                                reorderable={false}
                                style={{ '--file-index': index } as CSSProperties}
                            />
                        ))}
                    </div>
                </section>

                <div className="recent-important__attention-grid">
                    <section className="recent-important__panel">
                        <div className="recent-important__head recent-important__head--shared">
                            <span>Sharing</span>
                            <h2>Shared with me</h2>
                        </div>
                        <div className="recent-important__list recent-important__list--compact">
                            {sharedFiles.length === 0 && <p className="recent-important__empty">No shared files are waiting for attention.</p>}
                            {sharedFiles.map((item) => (
                                <article className="recent-important__row recent-important__row--action" key={item.id}>
                                    <span className="recent-important__row-main">
                                        <strong>{item.filename}</strong>
                                        <small>
                                            {item.shared_by_user_name ?? 'Unknown owner'} · {item.permissions}
                                        </small>
                                    </span>
                                    <button className="btn btn--outline" type="button" onClick={() => void onPreview(item)}>
                                        Open
                                    </button>
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className="recent-important__panel recent-important__panel--invites">
                        <div className="recent-important__head recent-important__head--invites">
                            <span>Invites</span>
                            <h2>Pending invitations</h2>
                        </div>
                        <div className="recent-important__list recent-important__list--compact">
                            {incomingGroupInvites.length === 0 && <p className="recent-important__empty">No pending invitations.</p>}
                            {incomingGroupInvites.map((invite) => (
                                <article className="recent-important__row recent-important__row--action" key={invite.id}>
                                    <span className="recent-important__row-main">
                                        <strong>{invite.groupName}</strong>
                                        <small>
                                            {invite.invitedByEmail} · {invite.role} · expires {formatDateTime(invite.expiresAt)}
                                        </small>
                                    </span>
                                    <span className="recent-important__actions">
                                        <button className="btn btn--outline" type="button" onClick={() => onAcceptInvite(invite.id)}>
                                            Accept
                                        </button>
                                        <button className="btn btn--ghost" type="button" onClick={() => onDeclineInvite(invite.id)}>
                                            Decline
                                        </button>
                                    </span>
                                </article>
                            ))}
                        </div>
                    </section>
                </div>

                <section className="recent-important__panel recent-important__panel--wide">
                    <div className="recent-important__head recent-important__head--expiry">
                        <span>Deadlines</span>
                        <h2>Access expiring within 7 days</h2>
                    </div>
                    <div className="recent-important__list recent-important__list--alerts">
                        {expiringLinkAlerts.length === 0 && (
                            <p className="recent-important__empty">No public file or folder links expire in the next 7 days.</p>
                        )}
                        {expiringLinkAlerts.map((alert) => (
                            <article className="recent-important__row recent-important__row--action" key={`expiry:${alert.kind}:${alert.id}`}>
                                <span className="recent-important__row-main">
                                    <strong>{alert.name}</strong>
                                    <small>{alert.detail}</small>
                                </span>
                                <button
                                    className="btn btn--outline recent-important__danger"
                                    type="button"
                                    disabled={blockingLinkId === alert.id}
                                    onClick={() => void blockPublicLink(alert)}
                                >
                                    {blockingLinkId === alert.id ? 'Revoking...' : 'Revoke access'}
                                </button>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="recent-important__panel recent-important__panel--wide">
                    <div className="recent-important__head recent-important__head--security">
                        <span>Security</span>
                        <h2>Alerts</h2>
                    </div>
                    <div className="recent-important__list recent-important__list--alerts">
                        {securityError && <p className="recent-important__empty">{securityError}</p>}
                        {!securityError && securityLoading && <p className="recent-important__empty">Loading security alerts...</p>}
                        {!securityError && !securityLoading && securityAlertCount === 0 && (
                            <p className="recent-important__empty">No important security alerts right now.</p>
                        )}
                        {publicLinkAlerts.map((alert) => (
                            <article className="recent-important__row recent-important__row--action" key={`${alert.kind}:${alert.id}`}>
                                <span className="recent-important__row-main">
                                    <strong>{alert.name}</strong>
                                    <small>{alert.detail} · {formatRelative(alert.updatedAt)}</small>
                                </span>
                                <button
                                    className="btn btn--outline recent-important__danger"
                                    type="button"
                                    disabled={blockingLinkId === alert.id}
                                    onClick={() => void blockPublicLink(alert)}
                                >
                                    {blockingLinkId === alert.id ? 'Blocking...' : 'Block link'}
                                </button>
                            </article>
                        ))}
                        {securityOperations.map((entry) => (
                            <article className="recent-important__row" key={entry.id}>
                                <span className="recent-important__row-main">
                                    <strong>{operationLabels[entry.operation] ?? entry.operation}</strong>
                                    <small>{entry.device_label ?? 'Unknown device'}</small>
                                </span>
                                <time dateTime={entry.created_at}>{formatRelative(entry.created_at)}</time>
                            </article>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    )
}
