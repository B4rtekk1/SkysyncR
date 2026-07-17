import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import {
    createFileShare,
    deleteFileShare,
    getFileShareRecipient,
    listFileShares,
    type FileSharePermission,
    type FileSharePerson,
} from '../../api/files'
import { unwrapFileKeyForUser, wrapFileKeyForUser } from '../../crypto/fileEncryption'
import { COPY_ICON } from './icons'
import { createQrPath } from './qr'
import type { ShareableItem } from './types'

type ShareFileModalProps = {
    item: ShareableItem
    itemKind: 'file' | 'folder'
    shareUrl: string | null
    loading: boolean
    privateKey: CryptoKey | null
    onClose: () => void
    onEnableShare: (expiresInSeconds?: number | null, downloadLimit?: number | null) => Promise<void>
    onDisableShare: () => Promise<void>
}

type SharePerson = {
    id: string
    email: string
    permission: FileSharePermission
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_SHARE_DURATION_SECONDS = 60 * 60 * 24 * 7
const SHARE_DURATION_OPTIONS = [
    { label: '1 hour', description: 'Temporary access', value: 60 * 60 },
    { label: '1 day', description: 'Expires tomorrow', value: 60 * 60 * 24 },
    { label: '7 days', description: 'Default access', value: DEFAULT_SHARE_DURATION_SECONDS },
    { label: '30 days', description: 'Longer project access', value: 60 * 60 * 24 * 30 },
    { label: 'No expiry', description: 'Manual stop only', value: null },
]
const PERMISSION_OPTIONS: Array<{
    value: FileSharePermission
    label: string
    description: string
}> = [
    { value: 'read', label: 'Can view', description: 'Open only' },
    { value: 'download', label: 'Can download', description: 'View and save' },
    { value: 'write', label: 'Can edit', description: 'Change content' },
]

function PermissionDropdown({
    ariaLabel,
    onChange,
    value,
}: {
    ariaLabel: string
    onChange: (permission: FileSharePermission) => void
    value: FileSharePermission
}) {
    const [open, setOpen] = useState(false)
    const placement = 'up'
    const rootRef = useRef<HTMLDivElement>(null)
    const selected = PERMISSION_OPTIONS.find((option) => option.value === value) ?? PERMISSION_OPTIONS[0]

    function handleBlur(e: FocusEvent<HTMLDivElement>) {
        const nextTarget = e.relatedTarget
        if (!nextTarget || !e.currentTarget.contains(nextTarget as Node)) {
            setOpen(false)
        }
    }

    return (
        <div
            className={`share-permission ${open ? 'is-open' : ''} share-permission--${placement}`}
            ref={rootRef}
            onBlur={handleBlur}
        >
            <button
                className="share-permission__trigger"
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span>
                    <strong>{selected.label}</strong>
                    <small>{selected.description}</small>
                </span>
                <span className="share-permission__chevron" aria-hidden="true">
                    v
                </span>
            </button>
            {open && (
                <div className="share-permission__menu" role="listbox" aria-label={ariaLabel}>
                    {PERMISSION_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            className={`share-permission__option ${option.value === value ? 'is-selected' : ''}`}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            onClick={() => {
                                onChange(option.value)
                                setOpen(false)
                            }}
                        >
                            <span>
                                <strong>{option.label}</strong>
                                <small>{option.description}</small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function ShareDurationDropdown({
    disabled,
    onChange,
    value,
}: {
    disabled: boolean
    onChange: (duration: number | null) => void
    value: number | null
}) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const selected = SHARE_DURATION_OPTIONS.find((option) => option.value === value) ?? SHARE_DURATION_OPTIONS[2]

    function handleBlur(e: FocusEvent<HTMLDivElement>) {
        const nextTarget = e.relatedTarget
        if (!nextTarget || !e.currentTarget.contains(nextTarget as Node)) {
            setOpen(false)
        }
    }

    return (
        <div
            className={`share-permission share-duration ${open ? 'is-open' : ''}`}
            ref={rootRef}
            onBlur={handleBlur}
        >
            <button
                className="share-permission__trigger"
                type="button"
                onClick={() => setOpen((current) => !current)}
                disabled={disabled}
                aria-label="Link duration"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span>
                    <strong>{selected.label}</strong>
                    <small>{selected.description}</small>
                </span>
                <span className="share-permission__chevron" aria-hidden="true">
                    v
                </span>
            </button>
            {open && (
                <div className="share-permission__menu" role="listbox" aria-label="Link duration">
                    {SHARE_DURATION_OPTIONS.map((option) => (
                        <button
                            key={option.label}
                            className={`share-permission__option ${option.value === value ? 'is-selected' : ''}`}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            onClick={() => {
                                onChange(option.value)
                                setOpen(false)
                            }}
                        >
                            <span>
                                <strong>{option.label}</strong>
                                <small>{option.description}</small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export function ShareFileModal({
    item,
    itemKind,
    shareUrl,
    loading,
    privateKey,
    onClose,
    onEnableShare,
    onDisableShare,
}: ShareFileModalProps) {
    const [people, setPeople] = useState<SharePerson[]>([])
    const [emailDraft, setEmailDraft] = useState('')
    const [permissionDraft, setPermissionDraft] = useState<FileSharePermission>('read')
    const [shareDuration, setShareDuration] = useState<number | null>(DEFAULT_SHARE_DURATION_SECONDS)
    const [downloadLimitDraft, setDownloadLimitDraft] = useState(() =>
        'filename' in item && item.share_download_limit ? String(item.share_download_limit) : '',
    )
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [peopleLoading, setPeopleLoading] = useState(false)
    const [peopleSaving, setPeopleSaving] = useState(false)
    const [sharePreviewBaseTime] = useState(() => Date.now())
    const requestedShareRef = useRef<string | null>(null)
    const qr = useMemo(() => (shareUrl ? createQrPath(shareUrl) : null), [shareUrl])
    const isFileShare = 'filename' in item
    const title = isFileShare ? item.filename : item.name
    const linkInputValue = shareUrl ?? (item.is_public || loading ? 'Generating link...' : 'Link is inactive')
    const selectedExpiresAt = shareDuration === null ? null : new Date(sharePreviewBaseTime + shareDuration * 1000)
    const expiryLabel = selectedExpiresAt
        ? `Expires ${selectedExpiresAt.toLocaleString([], {
              dateStyle: 'medium',
              timeStyle: 'short',
          })}`
        : 'No expiry'
    const downloadLimit = downloadLimitDraft.trim() ? Number(downloadLimitDraft) : null
    const hasInvalidDownloadLimit =
        itemKind === 'file' &&
        downloadLimitDraft.trim() !== '' &&
        (downloadLimit === null || !Number.isInteger(downloadLimit) || downloadLimit < 1 || downloadLimit > 1000000)
    const downloadLimitLabel =
        isFileShare
            ? downloadLimit
                ? `${item.share_download_count ?? 0} / ${downloadLimit} downloads`
                : `${item.share_download_count ?? 0} downloads, no limit`
            : null

    function toSharePerson(person: FileSharePerson): SharePerson {
        return {
            id: person.id,
            email: person.email,
            permission: person.permission,
        }
    }

    useEffect(() => {
        function closeOnEscape(e: globalThis.KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [onClose])

    useEffect(() => {
        if (item.is_public && item.share_token) {
            requestedShareRef.current = item.id
            return
        }

        if (!item.is_public || !item.share_token) {
            if (requestedShareRef.current === item.id) return
            requestedShareRef.current = item.id
            void onEnableShare(shareDuration, hasInvalidDownloadLimit ? null : downloadLimit).catch((e) => {
                setError(e instanceof Error ? e.message : 'Could not generate share link.')
            })
        }
    }, [downloadLimit, hasInvalidDownloadLimit, item.id, item.is_public, item.share_token, onEnableShare, shareDuration])

    useEffect(() => {
        let active = true
        if (!isFileShare) {
            return () => {
                active = false
            }
        }

        async function loadPeople() {
            setPeopleLoading(true)
            setError(null)
            try {
                const shares = await listFileShares(item.id)
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
        if (!isFileShare) return null
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to share encrypted files.')
        }

        const recipient = await getFileShareRecipient(item.id, email)
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        const wrappedKey = await wrapFileKeyForUser(fileKey, recipient.public_key)
        return createFileShare({
            fileId: item.id,
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

    async function removePerson(person: SharePerson) {
        if (!isFileShare) return
        setError(null)
        setPeopleSaving(true)
        try {
            await deleteFileShare(item.id, person.id)
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
                className="share-modal__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-title"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="share-modal__head">
                    <div className="share-modal__title">
                        <p className="eyebrow">
                            <span className="eyebrow__dot" /> share {itemKind}
                        </p>
                        <h2 id="share-title">{title}</h2>
                    </div>
                    <button className="image-preview__close" type="button" onClick={onClose} aria-label="Close share dialog">
                        x
                    </button>
                </header>

                <div className="share-modal__body">
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
                        {itemKind === 'file' && (
                            <>
                                <div className="share-modal__expiry">
                                    <span>Link duration</span>
                                    <ShareDurationDropdown
                                        disabled={loading}
                                        value={shareDuration}
                                        onChange={setShareDuration}
                                    />
                                    <span>{expiryLabel}</span>
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
                            </>
                        )}
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
                                onClick={() => void onEnableShare(itemKind === 'file' ? shareDuration : undefined, itemKind === 'file' ? downloadLimit : undefined)}
                                disabled={loading || hasInvalidDownloadLimit}
                            >
                                {item.is_public ? 'Update link' : 'Create link'}
                            </button>
                            <button className="btn btn--outline" type="button" onClick={() => void onDisableShare()} disabled={loading}>
                                Stop sharing
                            </button>
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
                            ) : item.is_public || loading ? (
                                <span className="spinner" />
                            ) : (
                                <span className="share-modal__qr-empty">No active link</span>
                            )}
                        </div>
                    </section>

                    <section className="share-modal__panel share-modal__panel--people">
                        <div className="share-modal__section-head">
                            <h3>People with accounts</h3>
                            <span>{peopleLoading ? '...' : people.length}</span>
                        </div>
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
                            <button className="btn btn--solid" type="button" onClick={() => void addPerson()} disabled={peopleSaving || !isFileShare}>
                                {peopleSaving ? 'Saving' : 'Add'}
                            </button>
                        </div>
                        <div className="share-modal__people-list">
                            {!isFileShare ? (
                                <p className="share-modal__empty">Account sharing is available for files.</p>
                            ) : peopleLoading ? (
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
                </div>

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
