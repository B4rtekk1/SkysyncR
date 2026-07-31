import { useEffect, useMemo, useState } from 'react'
import type { ApiFile, ApiFolder } from '../../../api/files'
import {
    getOperationLog,
    getSessions,
    revokeSession,
    updateSessionTrust,
    type OperationLogEntry,
    type SessionsResponse,
} from '../../../api/users'
import { formatBytes, formatRelative } from '../fileUtils'
import { describeApproximateLocation } from '../sessionDisplay'

type PublicLinkItem =
    | {
          kind: 'file'
          id: string
          name: string
          sizeBytes: number
          updatedAt: string
          shareToken: string
          startsAt: string | null
          expiresAt: string | null
          downloadLimit: number | null
          downloadCount: number
          oneTime: boolean
          passwordEnabled: boolean
          recipientEmail: string | null
      }
    | {
          kind: 'folder'
          id: string
          name: string
          updatedAt: string
          shareToken: string
      }

type SecurityCenterPanelProps = {
    files: ApiFile[]
    folders: ApiFolder[]
    onBlockFileLink: (file: ApiFile) => Promise<void>
    onBlockFolderLink: (folder: ApiFolder) => Promise<void>
    onSignOutCurrentSession: () => Promise<void>
}

const riskyOperations = new Set([
    'file.share',
    'file.update',
    'file.version.restore',
    'user.password.change',
    'user.logout_all',
    'user.session.revoke',
])

const operationLabels: Record<string, string> = {
    'file.upload': 'Uploaded file',
    'file.download': 'Downloaded file',
    'file.rename': 'Renamed file',
    'file.move': 'Moved file',
    'file.update': 'Updated file',
    'file.delete': 'Deleted file',
    'file.restore': 'Restored file',
    'file.version.restore': 'Restored file version',
    'file.share': 'Created or changed public access',
    'file.unshare': 'Blocked public access',
    'user.password.change': 'Changed password',
    'user.logout_all': 'Signed out everywhere',
    'user.session.revoke': 'Signed out device',
}

const sessionActionLabels: Record<string, string> = {
    login: 'Signed in',
    refresh: 'Session refreshed',
    logout: 'Signed out',
    logout_all: 'Signed out everywhere',
    revoked: 'Session revoked',
    trust_changed: 'Trusted device changed',
}

function formatTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown time'
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date)
}

function toPublicLinks(files: ApiFile[], folders: ApiFolder[]): PublicLinkItem[] {
    const publicFiles = files
        .filter((file) => file.is_public && file.share_token && !file.is_deleted)
        .map((file): PublicLinkItem => ({
            kind: 'file',
            id: file.id,
            name: file.filename,
            sizeBytes: file.size_bytes,
            updatedAt: file.updated_at,
            shareToken: file.share_token as string,
            startsAt: file.share_starts_at,
            expiresAt: file.share_expires_at,
            downloadLimit: file.share_download_limit,
            downloadCount: file.share_download_count,
            oneTime: file.share_one_time,
            passwordEnabled: file.share_password_enabled,
            recipientEmail: file.share_recipient_email,
        }))

    const publicFolders = folders
        .filter((folder) => folder.is_public && folder.share_token && !folder.is_deleted)
        .map((folder): PublicLinkItem => ({
            kind: 'folder',
            id: folder.id,
            name: folder.name,
            updatedAt: folder.updated_at,
            shareToken: folder.share_token as string,
        }))

    return [...publicFiles, ...publicFolders].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

function recentSuspiciousOperations(operations: OperationLogEntry[], files: ApiFile[]): OperationLogEntry[] {
    const now = Date.now()
    const recentDeletes = operations.filter((entry) => entry.operation === 'file.delete' && now - new Date(entry.created_at).getTime() < 30 * 60 * 1000)
    const recentUpdates = operations.filter((entry) => entry.operation === 'file.update' && now - new Date(entry.created_at).getTime() < 30 * 60 * 1000)
    const massActivityIds = new Set<string>()
    const favouriteFileIds = new Set(files.filter((file) => file.is_favourite).map((file) => file.id))

    if (recentDeletes.length >= 5) recentDeletes.forEach((entry) => massActivityIds.add(entry.id))
    if (recentUpdates.length >= 10) recentUpdates.forEach((entry) => massActivityIds.add(entry.id))

    return operations
        .filter(
            (entry) =>
                riskyOperations.has(entry.operation) ||
                massActivityIds.has(entry.id) ||
                (entry.operation === 'file.delete' && entry.resource_id !== null && favouriteFileIds.has(entry.resource_id)),
        )
        .slice(0, 10)
}

export function SecurityCenterPanel({
    files,
    folders,
    onBlockFileLink,
    onBlockFolderLink,
    onSignOutCurrentSession,
}: SecurityCenterPanelProps) {
    const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [blockingLinkId, setBlockingLinkId] = useState<string | null>(null)
    const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
    const [trustingSessionId, setTrustingSessionId] = useState<string | null>(null)

    const publicLinks = useMemo(() => toPublicLinks(files, folders), [files, folders])
    const suspiciousOperations = useMemo(() => recentSuspiciousOperations(operationLog, files), [files, operationLog])
    const restoreHistory = useMemo(
        () => operationLog.filter((entry) => entry.operation === 'file.restore' || entry.operation === 'file.version.restore').slice(0, 8),
        [operationLog],
    )

    async function loadSecurityData() {
        setLoading(true)
        setError(null)
        try {
            const [sessions, logs] = await Promise.all([getSessions(), getOperationLog()])
            setSessionsData(sessions)
            setOperationLog(logs.operations)
        } catch {
            setError('Could not load security center data.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void Promise.resolve().then(loadSecurityData)
    }, [])

    async function blockLink(link: PublicLinkItem) {
        setBlockingLinkId(link.id)
        setError(null)
        try {
            if (link.kind === 'file') {
                const file = files.find((item) => item.id === link.id)
                if (file) await onBlockFileLink(file)
            } else {
                const folder = folders.find((item) => item.id === link.id)
                if (folder) await onBlockFolderLink(folder)
            }
            await loadSecurityData()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not block that public link.')
        } finally {
            setBlockingLinkId(null)
        }
    }

    async function signOutSession(sessionId: string, current: boolean) {
        setRevokingSessionId(sessionId)
        setError(null)
        try {
            await revokeSession(sessionId)
            if (current) {
                await onSignOutCurrentSession()
                return
            }
            await loadSecurityData()
        } catch {
            setError('Could not sign out this device.')
        } finally {
            setRevokingSessionId(null)
        }
    }

    async function toggleTrustedSession(sessionId: string, trusted: boolean) {
        setTrustingSessionId(sessionId)
        setError(null)
        try {
            await updateSessionTrust(sessionId, trusted)
            await loadSecurityData()
        } catch {
            setError('Could not update trusted device.')
        } finally {
            setTrustingSessionId(null)
        }
    }

    return (
        <div className="security-center">
            {error && <p className="shell__error">{error}</p>}
            {loading && <p className="shell__loading">Loading security center...</p>}

            <section className="security-center__metrics" aria-label="Security summary">
                <div className="security-center__metric">
                    <span>Suspicious operations</span>
                    <strong>{suspiciousOperations.length}</strong>
                </div>
                <div className="security-center__metric">
                    <span>Restore events</span>
                    <strong>{restoreHistory.length}</strong>
                </div>
                <div className="security-center__metric">
                    <span>Public links</span>
                    <strong>{publicLinks.length}</strong>
                </div>
                <div className="security-center__metric">
                    <span>Signed-in devices</span>
                    <strong>{sessionsData?.sessions.length ?? '-'}</strong>
                </div>
            </section>

            <div className="security-center__layout">
                <section className="security-center__panel">
                    <div className="security-center__head">
                        <span>Risk review</span>
                        <h2>Suspicious operations</h2>
                    </div>
                    <div className="security-center__list">
                        {suspiciousOperations.length === 0 && <p className="security-center__empty">No suspicious operations in the recent log.</p>}
                        {suspiciousOperations.map((entry) => (
                            <article className="security-center__row" key={entry.id}>
                                <span className="security-center__row-main">
                                    <strong>{operationLabels[entry.operation] ?? entry.operation}</strong>
                                    <small>{entry.device_label ?? 'Unknown device'}</small>
                                </span>
                                <time dateTime={entry.created_at}>{formatRelative(entry.created_at)}</time>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="security-center__panel">
                    <div className="security-center__head">
                        <span>Recovery</span>
                        <h2>Restore history</h2>
                    </div>
                    <div className="security-center__list">
                        {restoreHistory.length === 0 && <p className="security-center__empty">No restore actions recorded yet.</p>}
                        {restoreHistory.map((entry) => (
                            <article className="security-center__row" key={entry.id}>
                                <span className="security-center__row-main">
                                    <strong>{operationLabels[entry.operation] ?? entry.operation}</strong>
                                    <small>{entry.resource_type ?? 'file'} {entry.resource_id ?? ''}</small>
                                </span>
                                <time dateTime={entry.created_at}>{formatTime(entry.created_at)}</time>
                            </article>
                        ))}
                    </div>
                </section>
            </div>

            <section className="security-center__panel security-center__panel--wide">
                <div className="security-center__head">
                    <span>Exposure</span>
                    <h2>Active public links</h2>
                </div>
                <div className="security-center__list">
                    {publicLinks.length === 0 && <p className="security-center__empty">No active public links are visible in this vault snapshot.</p>}
                    {publicLinks.map((link) => (
                        <article className="security-center__row security-center__row--action" key={`${link.kind}:${link.id}`}>
                            <span className="security-center__row-main">
                                <strong>{link.name}</strong>
                                <small>
                                    {link.kind === 'file'
                                        ? `${formatBytes(link.sizeBytes)} · ${link.downloadCount}/${link.downloadLimit ?? 'unlimited'} downloads`
                                        : 'Folder link'}
                                </small>
                                {link.kind === 'file' && (
                                    <small>
                                        {link.startsAt ? `Starts ${formatTime(link.startsAt)} · ` : ''}
                                        {link.expiresAt ? `Expires ${formatTime(link.expiresAt)}` : 'No expiry'}
                                        {link.oneTime ? ' · one-time' : ''}
                                        {link.passwordEnabled ? ' · password' : ''}
                                        {link.recipientEmail ? ` · ${link.recipientEmail}` : ''}
                                    </small>
                                )}
                            </span>
                            <button
                                className="btn btn--outline security-center__danger"
                                type="button"
                                disabled={blockingLinkId === link.id}
                                onClick={() => void blockLink(link)}
                            >
                                {blockingLinkId === link.id ? 'Blocking...' : 'Block link'}
                            </button>
                        </article>
                    ))}
                </div>
            </section>

            <section className="security-center__panel security-center__panel--wide">
                <div className="security-center__head">
                    <span>Devices</span>
                    <h2>Signed-in devices</h2>
                </div>
                <div className="security-center__list">
                    {sessionsData?.sessions.length === 0 && <p className="security-center__empty">No active sessions were found.</p>}
                    {sessionsData?.sessions.map((session) => (
                        <article className="security-center__row security-center__row--action" key={session.id}>
                            <span className="security-center__row-main">
                                <strong>{session.device_label}</strong>
                                <small>
                                    Last active {formatTime(session.last_used_at)}
                                </small>
                                <small>{describeApproximateLocation(session.ip_address)}</small>
                                <small>Expires {formatTime(session.expires_at)}</small>
                            </span>
                            <span className="security-center__actions">
                                {session.current && <span className="security-center__badge">Current</span>}
                                {session.trusted && <span className="security-center__badge security-center__badge--trusted">Trusted</span>}
                                <button
                                    className="btn btn--outline"
                                    type="button"
                                    disabled={trustingSessionId === session.id}
                                    onClick={() => void toggleTrustedSession(session.id, !session.trusted)}
                                >
                                    {trustingSessionId === session.id ? 'Saving...' : session.trusted ? 'Untrust' : 'Trust'}
                                </button>
                                <button
                                    className="btn btn--outline"
                                    type="button"
                                    disabled={revokingSessionId === session.id}
                                    onClick={() => void signOutSession(session.id, session.current)}
                                >
                                    {revokingSessionId === session.id ? 'Signing out...' : 'Sign out'}
                                </button>
                            </span>
                        </article>
                    ))}
                </div>
                {sessionsData && sessionsData.activity.length > 0 && (
                    <div className="security-center__activity">
                        <h3>Session history</h3>
                        {sessionsData.activity.slice(0, 6).map((event) => (
                            <div className="security-center__activity-row" key={event.id}>
                                <span>{sessionActionLabels[event.action] ?? event.action}</span>
                                <small>{event.device_label ?? 'Unknown device'}</small>
                                <time dateTime={event.created_at}>{formatRelative(event.created_at)}</time>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
