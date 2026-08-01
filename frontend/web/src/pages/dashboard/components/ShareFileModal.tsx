import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import '../../../css/dashboard/sharing.css'
import {
    createFolderGroupShare,
    createFolderShare,
    createFileShare,
    deleteFolderGroupShare,
    deleteFolderShare,
    deleteFileShare,
    getFolderShareRecipient,
    getFileShareRecipient,
    listFolderGroupShareEvents,
    listFolderGroupShares,
    listFolderShares,
    listFileShares,
    listPublicFolderShareAccess,
    listPublicFileShareAccess,
    type FileSharePermission,
    type FileSharePerson,
    type FolderGroupShare,
    type FolderGroupShareEvent,
    type FolderGroupSharePermission,
    type PublicFileShareAccess,
    type PublicFolderShareAccess,
    updateFolderGroupShare,
} from '../../../api/files'
import { listGroupShareRecipients } from '../../../api/groups'
import { unwrapFileKeyForUser, wrapFileKeyForUser } from '../../../crypto/fileEncryption'
import { useModalA11y } from '../../../hooks/useModalA11y'
import { CLOSE_ICON, COPY_ICON } from '../icons'
import { createQrPath } from '../qr'
import { DEFAULT_SHARE_DURATION_SECONDS, FolderGroupPermissionDropdown, PermissionDropdown } from './shareControls'
import type { Group, GroupInviteRole, ShareableItem } from '../types'

type ShareFileModalProps = {
    item: ShareableItem
    itemKind: 'file' | 'folder'
    shareUrl: string | null
    shareUrlError: string | null
    loading: boolean
    privateKey: CryptoKey | null
    groups: Group[]
    onClose: () => void
    onEnableShare: (
        expiresInSeconds?: number | null,
        downloadLimit?: number | null,
        password?: string | null,
        recipientEmail?: string | null,
        startsAt?: string | null,
        expiresAt?: string | null,
        oneTime?: boolean,
    ) => Promise<void>
    onDisableShare: () => Promise<void>
    onExpireFileLinks?: (() => Promise<void>) | undefined
}

type SharePerson = {
    id: string
    email: string
    permission: FileSharePermission
}

type ShareAccessEvent = PublicFileShareAccess | PublicFolderShareAccess

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toDatetimeLocalValue(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60 * 1000
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function parseDatetimeLocalValue(value: string): Date | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : date
}

function formatAccessDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function eventFileId(event: ShareAccessEvent): string | null {
    return 'folder_id' in event ? event.file_id : event.file_id
}

export function ShareFileModal({
    item,
    itemKind,
    shareUrl,
    shareUrlError,
    loading,
    privateKey,
    groups,
    onClose,
    onEnableShare,
    onDisableShare,
    onExpireFileLinks,
}: ShareFileModalProps) {
    const [people, setPeople] = useState<SharePerson[]>([])
    const [emailDraft, setEmailDraft] = useState('')
    const [permissionDraft, setPermissionDraft] = useState<FileSharePermission>('read')
    const [shareStartsAtDraft, setShareStartsAtDraft] = useState(() =>
        item.share_starts_at ? toDatetimeLocalValue(new Date(item.share_starts_at)) : '',
    )
    const [shareExpiresAtDraft, setShareExpiresAtDraft] = useState(() =>
        item.share_expires_at
            ? toDatetimeLocalValue(new Date(item.share_expires_at))
            : toDatetimeLocalValue(new Date(Date.now() + DEFAULT_SHARE_DURATION_SECONDS * 1000)),
    )
    const [downloadLimitDraft, setDownloadLimitDraft] = useState(() =>
        item.share_download_limit ? String(item.share_download_limit) : '',
    )
    const [oneTimeDraft, setOneTimeDraft] = useState(() => item.share_one_time)
    const [sharePasswordDraft, setSharePasswordDraft] = useState('')
    const [shareRecipientEmailDraft, setShareRecipientEmailDraft] = useState(() =>
        item.share_recipient_email ?? '',
    )
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [peopleLoading, setPeopleLoading] = useState(false)
    const [peopleSaving, setPeopleSaving] = useState(false)
    const [accessEvents, setAccessEvents] = useState<ShareAccessEvent[]>([])
    const [accessLoading, setAccessLoading] = useState(false)
    const [selectedGroupId, setSelectedGroupId] = useState('')
    const [groupPermissionDraft, setGroupPermissionDraft] = useState<FolderGroupSharePermission>('read')
    const [folderGroupShares, setFolderGroupShares] = useState<FolderGroupShare[]>([])
    const [folderGroupEvents, setFolderGroupEvents] = useState<FolderGroupShareEvent[]>([])
    const [folderGroupsLoading, setFolderGroupsLoading] = useState(false)
    const [groupSharing, setGroupSharing] = useState(false)
    const [showLinkSettings, setShowLinkSettings] = useState(false)
    const requestedShareRef = useRef<string | null>(null)
    const dialogRef = useRef<HTMLElement>(null)
    const qr = useMemo(() => {
        if (!shareUrl) return null
        try {
            return createQrPath(shareUrl)
        } catch {
            return null
        }
    }, [shareUrl])
    const isFileShare = 'filename' in item
    const title = isFileShare ? item.filename : item.name
    const linkInputValue =
        shareUrl ??
        (item.is_public || loading
            ? !privateKey
                ? `Unlock your private key to create a secure ${itemKind} link`
                : shareUrlError ?? 'Generating link...'
            : 'Link is inactive')
    const shareStartsAt = parseDatetimeLocalValue(shareStartsAtDraft)
    const shareExpiresAt = parseDatetimeLocalValue(shareExpiresAtDraft)
    const startsAtIso = shareStartsAt ? shareStartsAt.toISOString() : null
    const expiresAtIso = shareExpiresAt ? shareExpiresAt.toISOString() : null
    const hasInvalidShareWindow =
        (shareStartsAtDraft.trim() !== '' && !shareStartsAt) ||
            (shareExpiresAtDraft.trim() !== '' && !shareExpiresAt) ||
            Boolean(shareStartsAt && shareExpiresAt && shareExpiresAt <= shareStartsAt)
    const activationLabel = shareStartsAt
        ? `Starts ${shareStartsAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'Active immediately'
    const expiryLabel = shareExpiresAt
        ? `Expires ${shareExpiresAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'No expiry'
    const downloadLimit = downloadLimitDraft.trim() ? Number(downloadLimitDraft) : null
    const hasInvalidDownloadLimit =
        downloadLimitDraft.trim() !== '' &&
        (downloadLimit === null || !Number.isInteger(downloadLimit) || downloadLimit < 1 || downloadLimit > 1000000)
    const sharePassword = sharePasswordDraft.trim()
    const shareRecipientEmail = shareRecipientEmailDraft.trim().toLowerCase()
    const hasInvalidSharePassword = sharePassword !== '' && (sharePassword.length < 8 || sharePassword.length > 128)
    const hasInvalidShareRecipientEmail = shareRecipientEmail !== '' && !EMAIL_PATTERN.test(shareRecipientEmail)
    const downloadLimitLabel =
        downloadLimit
            ? `${item.share_download_count ?? 0} / ${downloadLimit} downloads`
            : `${item.share_download_count ?? 0} downloads, no limit`

    function toSharePerson(person: FileSharePerson): SharePerson {
        return {
            id: person.id,
            email: person.email,
            permission: person.permission,
        }
    }

    function roleToPermission(role: GroupInviteRole): FileSharePermission {
        if (role === 'viewer') return 'read'
        return 'write'
    }

    function groupPermissionToPersonPermission(permission: FolderGroupSharePermission): FileSharePermission {
        return permission === 'read' ? 'read' : 'write'
    }

    useModalA11y({ dialogRef, onClose })

    useEffect(() => {
        if (item.is_public && item.share_token) {
            requestedShareRef.current = item.id
            return
        }

        if (!item.is_public || !item.share_token) {
            if (requestedShareRef.current === item.id) return
            requestedShareRef.current = item.id
            void onEnableShare(
                null,
                hasInvalidDownloadLimit ? null : downloadLimit,
                null,
                null,
                hasInvalidShareWindow ? null : startsAtIso,
                hasInvalidShareWindow ? null : expiresAtIso,
                oneTimeDraft,
            ).catch((e) => {
                setError(e instanceof Error ? e.message : 'Could not generate share link.')
            })
        }
    }, [downloadLimit, expiresAtIso, hasInvalidDownloadLimit, hasInvalidShareWindow, item.id, item.is_public, item.share_token, onEnableShare, oneTimeDraft, startsAtIso])

    useEffect(() => {
        let active = true
        async function loadPeople() {
            setPeopleLoading(true)
            setError(null)
            try {
                const shares = isFileShare ? await listFileShares(item.id) : await listFolderShares(item.id)
                if (active) setPeople(shares.map(toSharePerson))
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load shared people.')
            } finally {
                if (active) setPeopleLoading(false)
            }
        }

        void loadPeople()
        return () => {
            active = false
        }
    }, [isFileShare, item.id])

    useEffect(() => {
        let active = true
        async function loadAccessEvents() {
            setAccessLoading(true)
            try {
                const events = isFileShare
                    ? await listPublicFileShareAccess(item.id)
                    : await listPublicFolderShareAccess(item.id)
                if (active) setAccessEvents(events)
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load access report.')
            } finally {
                if (active) setAccessLoading(false)
            }
        }

        void loadAccessEvents()
        return () => {
            active = false
        }
    }, [isFileShare, item.id, item.share_download_count])

    useEffect(() => {
        let active = true
        async function loadFolderGroups() {
            if (isFileShare) {
                setFolderGroupShares([])
                setFolderGroupEvents([])
                return
            }

            setFolderGroupsLoading(true)
            try {
                const [shares, events] = await Promise.all([
                    listFolderGroupShares(item.id),
                    listFolderGroupShareEvents(item.id),
                ])
                if (active) {
                    setFolderGroupShares(shares)
                    setFolderGroupEvents(events)
                }
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load team access.')
            } finally {
                if (active) setFolderGroupsLoading(false)
            }
        }

        void loadFolderGroups()
        return () => {
            active = false
        }
    }, [isFileShare, item.id])

    async function copyShareUrl() {
        if (!shareUrl) return
        setError(null)
        try {
            await navigator.clipboard.writeText(shareUrl)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
        } catch {
            setError('Clipboard access is unavailable in this browser context.')
        }
    }

    async function savePerson(email: string, permission: FileSharePermission) {
        if (!privateKey) {
            throw new Error(`Private key is locked. Sign in again to share encrypted ${itemKind}s.`)
        }
        if (!item.encrypted_key) {
            throw new Error(`This ${itemKind} is missing an encryption key.`)
        }

        const recipient = isFileShare
            ? await getFileShareRecipient(item.id, email)
            : await getFolderShareRecipient(item.id, email)
        const itemKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        const wrappedKey = await wrapFileKeyForUser(itemKey, recipient.public_key)
        return isFileShare
            ? createFileShare({
                  fileId: item.id,
                  email: recipient.email,
                  permission,
                  encryptedKey: wrappedKey,
              })
            : createFolderShare({
                  folderId: item.id,
                  email: recipient.email,
                  permission,
                  encryptedKey: wrappedKey,
              })
    }

    async function addPerson() {
        const email = emailDraft.trim().toLowerCase()
        setError(null)

        if (!EMAIL_PATTERN.test(email)) {
            setError('Enter a valid email address.')
            return
        }

        setPeopleSaving(true)
        try {
            const saved = await savePerson(email, permissionDraft)
            if (!saved) return

            const next = toSharePerson(saved)
            setPeople((current) => {
                if (current.some((person) => person.id === next.id || person.email === next.email)) {
                    return current.map((person) =>
                        person.id === next.id || person.email === next.email ? next : person,
                    )
                }
                return [next, ...current]
            })
            setEmailDraft('')
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not share with that person.')
        } finally {
            setPeopleSaving(false)
        }
    }

    async function addGroup() {
        const group = groups.find((current) => current.id === selectedGroupId)
        if (!group) {
            setError('Choose a group to share with.')
            return
        }
        if (!privateKey) {
            setError(`Private key is locked. Sign in again to share encrypted ${itemKind}s.`)
            return
        }
        if (!item.encrypted_key) {
            setError(`This ${itemKind} is missing an encryption key.`)
            return
        }

        setError(null)
        setGroupSharing(true)
        try {
            const personPermission = isFileShare
                ? roleToPermission(group.defaultRole)
                : groupPermissionToPersonPermission(groupPermissionDraft)
            const recipients = await listGroupShareRecipients(group.id)
            if (recipients.length === 0) {
                setError('This group has no active account members with public keys.')
                return
            }

            const savedGroupShare = isFileShare
                ? null
                : await createFolderGroupShare({
                      folderId: item.id,
                      groupId: group.id,
                      permission: groupPermissionDraft,
                  })
            const itemKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
            const savedPeople = await Promise.all(
                recipients.map(async (recipient) => {
                    const wrappedKey = await wrapFileKeyForUser(itemKey, recipient.public_key)
                    return isFileShare
                        ? createFileShare({
                              fileId: item.id,
                              email: recipient.email,
                              permission: roleToPermission(recipient.role),
                              encryptedKey: wrappedKey,
                          })
                        : createFolderShare({
                              folderId: item.id,
                              email: recipient.email,
                              permission: personPermission,
                              encryptedKey: wrappedKey,
                          })
                }),
            )

            const nextPeople = savedPeople.map(toSharePerson)
            setPeople((current) => {
                const byEmail = new Map(current.map((person) => [person.email, person]))
                for (const person of nextPeople) byEmail.set(person.email, person)
                return Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email))
            })
            if (savedGroupShare) {
                setFolderGroupShares((current) => {
                    const existing = current.some((share) => share.id === savedGroupShare.id || share.group_id === savedGroupShare.group_id)
                    return existing
                        ? current.map((share) => (share.id === savedGroupShare.id || share.group_id === savedGroupShare.group_id ? savedGroupShare : share))
                        : [savedGroupShare, ...current]
                })
                setFolderGroupEvents(await listFolderGroupShareEvents(item.id))
            }
            setError(`Shared with ${nextPeople.length} group member${nextPeople.length === 1 ? '' : 's'}.`)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not share with that group.')
        } finally {
            setGroupSharing(false)
        }
    }

    function handleEmailKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        e.preventDefault()
        void addPerson()
    }

    async function updatePersonPermission(email: string, permission: FileSharePermission) {
        setError(null)
        setPeopleSaving(true)
        try {
            const saved = await savePerson(email, permission)
            if (!saved) return
            const next = toSharePerson(saved)
            setPeople((current) => current.map((person) => (person.email === email ? next : person)))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update permission.')
        } finally {
            setPeopleSaving(false)
        }
    }

    async function updateFolderGroupPermission(share: FolderGroupShare, permission: FolderGroupSharePermission) {
        setError(null)
        setGroupSharing(true)
        try {
            const saved = await updateFolderGroupShare({ folderId: item.id, shareId: share.id, permission })
            setFolderGroupShares((current) => current.map((currentShare) => (currentShare.id === saved.id ? saved : currentShare)))
            setFolderGroupEvents(await listFolderGroupShareEvents(item.id))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update team access.')
        } finally {
            setGroupSharing(false)
        }
    }

    async function removeFolderGroup(share: FolderGroupShare) {
        setError(null)
        setGroupSharing(true)
        try {
            await deleteFolderGroupShare(item.id, share.id)
            setFolderGroupShares((current) => current.filter((currentShare) => currentShare.id !== share.id))
            setFolderGroupEvents(await listFolderGroupShareEvents(item.id))
            const memberEmails = new Set(groups.find((group) => group.id === share.group_id)?.members.map((member) => member.email) ?? [])
            setPeople((current) => current.filter((person) => !memberEmails.has(person.email)))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove team access.')
        } finally {
            setGroupSharing(false)
        }
    }

    async function removePerson(person: SharePerson) {
        setError(null)
        setPeopleSaving(true)
        try {
            if (isFileShare) {
                await deleteFileShare(item.id, person.id)
            } else {
                await deleteFolderShare(item.id, person.id)
            }
            setPeople((current) => current.filter((currentPerson) => currentPerson.id !== person.id))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove access.')
        } finally {
            setPeopleSaving(false)
        }
    }

    return (
        <div className="share-modal" role="presentation" onMouseDown={onClose}>
            <section
                ref={dialogRef}
                className="share-modal__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-title"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="share-modal__head">
                    <div className="share-modal__title">
                        <p className="eyebrow">
                            share {itemKind}
                        </p>
                        <h2 id="share-title">{title}</h2>
                    </div>
                    <button className="share-modal__close" type="button" onClick={onClose} aria-label="Close share dialog">
                        {CLOSE_ICON}
                    </button>
                </header>

                <form className="share-modal__body" noValidate onSubmit={(event) => event.preventDefault()}>
                    <section className="share-modal__panel share-modal__panel--link">
                        <div className="share-modal__section-head">
                            <h3>Link</h3>
                            <span className={`share-modal__status ${item.is_public ? 'is-public' : ''}`}>
                                {loading ? 'Creating' : item.is_public ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <div className="share-modal__access-row">
                            <span>Anyone with this link</span>
                            <strong>{itemKind === 'folder' ? 'View folder' : 'View only'}</strong>
                        </div>
                        <section className="share-modal__settings">
                                <button
                                    className="share-modal__settings-trigger"
                                    type="button"
                                    onClick={() => setShowLinkSettings((current) => !current)}
                                    aria-expanded={showLinkSettings}
                                >
                                    <span>
                                        <strong>Link settings</strong>
                                        <small>
                                            {expiryLabel}
                                            {downloadLimit ? `, ${downloadLimit} downloads max` : ''}
                                            {oneTimeDraft ? ', one-time' : ''}
                                            {sharePassword || item.share_password_enabled ? ', password' : ''}
                                        </small>
                                    </span>
                                    <span className="share-modal__settings-chevron" aria-hidden="true">
                                        v
                                    </span>
                                </button>

                                {showLinkSettings && (
                                    <div className="share-modal__settings-grid">
                                        <div className="share-modal__expiry">
                                            <span>Activation date</span>
                                            <input
                                                className="share-modal__text-input"
                                                type="datetime-local"
                                                value={shareStartsAtDraft}
                                                onChange={(event) => setShareStartsAtDraft(event.target.value)}
                                                disabled={loading}
                                                aria-label="Activation date"
                                            />
                                            <span>{activationLabel}</span>
                                        </div>
                                        <div className="share-modal__expiry">
                                            <span>Expiration date</span>
                                            <input
                                                className="share-modal__text-input"
                                                type="datetime-local"
                                                value={shareExpiresAtDraft}
                                                onChange={(event) => setShareExpiresAtDraft(event.target.value)}
                                                disabled={loading}
                                                aria-label="Expiration date"
                                            />
                                            <span>{hasInvalidShareWindow ? 'Must be after activation' : expiryLabel}</span>
                                        </div>
                                        <div className="share-modal__expiry">
                                            <span>One-time link</span>
                                            <label className="share-modal__toggle">
                                                <input
                                                    type="checkbox"
                                                    checked={oneTimeDraft}
                                                    onChange={(event) => setOneTimeDraft(event.target.checked)}
                                                    disabled={loading}
                                                />
                                                <span>{oneTimeDraft ? 'Revokes after first download' : 'Reusable until limits apply'}</span>
                                            </label>
                                            <span>{oneTimeDraft ? 'Single use' : 'Multiple downloads'}</span>
                                        </div>
                                        <div className="share-modal__expiry">
                                            <span>Download limit</span>
                                            <input
                                                className="share-modal__number-input"
                                                type="number"
                                                min="1"
                                                max="1000000"
                                                step="1"
                                                inputMode="numeric"
                                                value={downloadLimitDraft}
                                                onChange={(event) => setDownloadLimitDraft(event.target.value)}
                                                placeholder="No limit"
                                                disabled={loading}
                                                aria-label="Download limit"
                                            />
                                            <span>{downloadLimitLabel}</span>
                                        </div>
                                        <div className="share-modal__expiry">
                                            <span>Link password</span>
                                            <input
                                                className="share-modal__text-input"
                                                type="password"
                                                autoComplete="current-password"
                                                minLength={8}
                                                maxLength={128}
                                                value={sharePasswordDraft}
                                                onChange={(event) => setSharePasswordDraft(event.target.value)}
                                                placeholder={item.share_password_enabled ? 'Password set' : 'No password'}
                                                disabled={loading}
                                                aria-label="Share link password"
                                            />
                                            <span>{sharePassword ? 'Will require password' : item.share_password_enabled ? 'Leave empty to remove' : 'Optional'}</span>
                                        </div>
                                        <div className="share-modal__expiry">
                                            <span>Recipient email</span>
                                            <input
                                                className="share-modal__text-input"
                                                type="email"
                                                autoComplete="username"
                                                value={shareRecipientEmailDraft}
                                                onChange={(event) => setShareRecipientEmailDraft(event.target.value)}
                                                placeholder="No email confirmation"
                                                disabled={loading}
                                                aria-label="Public link recipient email"
                                            />
                                            <span>{shareRecipientEmail ? 'Must match before download' : 'Optional'}</span>
                                        </div>
                                    </div>
                                )}
                        </section>
                        <div className="share-modal__link-row">
                            <input value={linkInputValue} readOnly aria-label="Share link" />
                            <button
                                className="file-card__action file-card__action--download"
                                type="button"
                                onClick={() => void copyShareUrl()}
                                disabled={!shareUrl || loading}
                                aria-label="Copy share link"
                                title="Copy link"
                            >
                                {COPY_ICON}
                            </button>
                        </div>
                        <div className="share-modal__actions">
                            <button
                                className="btn btn--outline"
                                type="button"
                                onClick={() =>
                                    void onEnableShare(
                                        null,
                                        downloadLimit,
                                        sharePasswordDraft,
                                        shareRecipientEmail,
                                        startsAtIso,
                                        expiresAtIso,
                                        oneTimeDraft,
                                    )
                                }
                                disabled={loading || hasInvalidDownloadLimit || hasInvalidSharePassword || hasInvalidShareRecipientEmail || hasInvalidShareWindow}
                            >
                                {item.is_public ? 'Update link' : 'Create link'}
                            </button>
                            <button className="btn btn--outline" type="button" onClick={() => void onDisableShare()} disabled={loading}>
                                Stop sharing
                            </button>
                            {onExpireFileLinks && (
                                <button className="btn btn--outline" type="button" onClick={() => void onExpireFileLinks()} disabled={loading}>
                                    Expire links
                                </button>
                            )}
                        </div>
                    </section>

                    <section className="share-modal__panel share-modal__panel--qr">
                        <div className="share-modal__section-head">
                            <h3>QR code</h3>
                        </div>
                        <div className="share-modal__qr" aria-label="QR code for share link">
                            {qr ? (
                                <svg className="share-modal__qr-svg" viewBox={qr.viewBox} role="img" aria-label="Share link QR code">
                                    <rect className="share-modal__qr-bg" x="0" y="0" width="100%" height="100%" rx="5" />
                                    <path className="share-modal__qr-modules" d={qr.path} />
                                </svg>
                            ) : shareUrl ? (
                                <span className="share-modal__qr-empty">Link is too long for QR</span>
                            ) : shareUrlError ? (
                                <span className="share-modal__qr-empty">{shareUrlError}</span>
                            ) : item.is_public || loading ? (
                                <span className="spinner" />
                            ) : (
                                <span className="share-modal__qr-empty">No active link</span>
                            )}
                        </div>
                    </section>

                    <section className="share-modal__panel share-modal__panel--access">
                        <div className="share-modal__section-head">
                            <h3>Access report</h3>
                            <span>{accessLoading ? '...' : accessEvents.length}</span>
                        </div>
                        <div className="share-modal__access-list">
                            {accessLoading ? (
                                <p className="share-modal__empty">Loading access report...</p>
                            ) : accessEvents.length === 0 ? (
                                <p className="share-modal__empty">No public downloads yet.</p>
                            ) : (
                                accessEvents.slice(0, 6).map((event) => (
                                    <div className="share-modal__access-event" key={event.id}>
                                        <span>{formatAccessDate(event.accessed_at)}</span>
                                        <strong>{event.recipient_email ?? 'Anonymous link'}</strong>
                                        <small>
                                            {itemKind === 'folder' && eventFileId(event)
                                                ? `File ${eventFileId(event)?.slice(0, 8)}`
                                                : event.user_agent ?? 'No client details'}
                                        </small>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="share-modal__panel share-modal__panel--people">
                        <div className="share-modal__section-head">
                            <h3>People with accounts</h3>
                            <span>{peopleLoading ? '...' : people.length}</span>
                        </div>
                        {isFileShare && (
                            <div className="share-modal__group-form">
                                <select
                                    value={selectedGroupId}
                                    onChange={(event) => setSelectedGroupId(event.target.value)}
                                    disabled={groupSharing || groups.length === 0}
                                    aria-label="Group"
                                >
                                    <option value="">Choose group</option>
                                    {groups.map((group) => (
                                        <option key={group.id} value={group.id}>
                                            {group.name}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="btn btn--outline"
                                    type="button"
                                    onClick={() => void addGroup()}
                                    disabled={groupSharing || !selectedGroupId}
                                >
                                    {groupSharing ? 'Sharing' : 'Share with group'}
                                </button>
                            </div>
                        )}
                        <div className="share-modal__person-form">
                            <input
                                value={emailDraft}
                                onChange={(e) => setEmailDraft(e.target.value)}
                                onKeyDown={handleEmailKeyDown}
                                placeholder="name@example.com"
                                aria-label="Person email"
                            />
                            <PermissionDropdown
                                ariaLabel="Permission"
                                value={permissionDraft}
                                onChange={setPermissionDraft}
                            />
                            <button className="btn btn--solid" type="button" onClick={() => void addPerson()} disabled={peopleSaving}>
                                {peopleSaving ? 'Saving' : 'Add'}
                            </button>
                        </div>
                        <div className="share-modal__people-list">
                            {peopleLoading ? (
                                <p className="share-modal__empty">Loading people...</p>
                            ) : people.length === 0 ? (
                                <p className="share-modal__empty">Add account email addresses to grant explicit permissions.</p>
                            ) : (
                                people.map((person) => (
                                    <div className="share-modal__person" key={person.email}>
                                        <span>{person.email}</span>
                                        <PermissionDropdown
                                            ariaLabel={`Permission for ${person.email}`}
                                            value={person.permission}
                                            onChange={(permission) => void updatePersonPermission(person.email, permission)}
                                        />
                                        <button type="button" onClick={() => void removePerson(person)} aria-label={`Remove ${person.email}`}>
                                            x
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    {!isFileShare && (
                        <section className="share-modal__panel share-modal__panel--teams">
                            <div className="share-modal__section-head">
                                <h3>Teams</h3>
                                <span>{folderGroupsLoading ? '...' : folderGroupShares.length}</span>
                            </div>
                            <div className="share-modal__group-form">
                                <select
                                    value={selectedGroupId}
                                    onChange={(event) => setSelectedGroupId(event.target.value)}
                                    disabled={groupSharing || groups.length === 0}
                                    aria-label="Folder team"
                                >
                                    <option value="">Choose group</option>
                                    {groups.map((group) => (
                                        <option key={group.id} value={group.id}>
                                            {group.name}
                                        </option>
                                    ))}
                                </select>
                                <FolderGroupPermissionDropdown
                                    ariaLabel="Team folder permission"
                                    value={groupPermissionDraft}
                                    onChange={setGroupPermissionDraft}
                                />
                                <button
                                    className="btn btn--outline"
                                    type="button"
                                    onClick={() => void addGroup()}
                                    disabled={groupSharing || !selectedGroupId}
                                >
                                    {groupSharing ? 'Sharing' : 'Assign group'}
                                </button>
                            </div>
                            <div className="share-modal__people-list">
                                {folderGroupsLoading ? (
                                    <p className="share-modal__empty">Loading teams...</p>
                                ) : folderGroupShares.length === 0 ? (
                                    <p className="share-modal__empty">Assign a group to manage team folder access.</p>
                                ) : (
                                    folderGroupShares.map((share) => (
                                        <div className="share-modal__person" key={share.id}>
                                            <span>{share.group_name}</span>
                                            <FolderGroupPermissionDropdown
                                                ariaLabel={`Permission for ${share.group_name}`}
                                                value={share.permission}
                                                onChange={(permission) => void updateFolderGroupPermission(share, permission)}
                                            />
                                            <button type="button" onClick={() => void removeFolderGroup(share)} aria-label={`Remove ${share.group_name}`}>
                                                x
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                            {folderGroupEvents.length > 0 && (
                                <div className="share-modal__team-history">
                                    {folderGroupEvents.slice(0, 5).map((event) => (
                                        <div className="share-modal__access-event" key={event.id}>
                                            <span>{formatAccessDate(event.created_at)}</span>
                                            <strong>{event.actor_email ?? 'Unknown user'}</strong>
                                            <small>
                                                {event.group_name ?? 'Deleted group'}: {event.action}
                                                {event.new_permission ? ` ${event.new_permission}` : ''}
                                            </small>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </form>

                <footer className="share-modal__footer">
                    <span>{copied ? 'Copied' : error ?? `${people.length} selected`}</span>
                    <button className="btn btn--solid" type="button" onClick={onClose} disabled={loading}>
                        Save
                    </button>
                </footer>
            </section>
        </div>
    )
}
