import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { COPY_ICON } from './icons'
import { createQrPath } from './qr'
import type { Item } from './types'

type ShareFileModalProps = {
    item: Item
    shareUrl: string | null
    loading: boolean
    onClose: () => void
    onEnableShare: () => Promise<void>
    onDisableShare: () => Promise<void>
}

type SharePerson = {
    email: string
    permission: 'read' | 'download' | 'write'
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PERMISSION_OPTIONS: Array<{
    value: SharePerson['permission']
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
    onChange: (permission: SharePerson['permission']) => void
    value: SharePerson['permission']
}) {
    const [open, setOpen] = useState(false)
    const [placement, setPlacement] = useState<'down' | 'up'>('down')
    const rootRef = useRef<HTMLDivElement>(null)
    const selected = PERMISSION_OPTIONS.find((option) => option.value === value) ?? PERMISSION_OPTIONS[0]
    const updatePlacement = useCallback(() => {
        const root = rootRef.current
        if (!root) return

        const rect = root.getBoundingClientRect()
        const menuHeight = 154
        const gap = 8
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        setPlacement(spaceBelow < menuHeight + gap && spaceAbove > spaceBelow ? 'up' : 'down')
    }, [])

    function handleBlur(e: FocusEvent<HTMLDivElement>) {
        const nextTarget = e.relatedTarget
        if (!nextTarget || !e.currentTarget.contains(nextTarget as Node)) {
            setOpen(false)
        }
    }

    useEffect(() => {
        if (!open) return undefined

        updatePlacement()
        window.addEventListener('resize', updatePlacement)
        window.addEventListener('scroll', updatePlacement, true)

        return () => {
            window.removeEventListener('resize', updatePlacement)
            window.removeEventListener('scroll', updatePlacement, true)
        }
    }, [open, updatePlacement])

    return (
        <div
            className={`share-permission ${open ? 'is-open' : ''} share-permission--${placement}`}
            ref={rootRef}
            onBlur={handleBlur}
        >
            <button
                className="share-permission__trigger"
                type="button"
                onClick={() => {
                    updatePlacement()
                    setOpen((current) => !current)
                }}
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

export function ShareFileModal({
    item,
    shareUrl,
    loading,
    onClose,
    onEnableShare,
    onDisableShare,
}: ShareFileModalProps) {
    const [people, setPeople] = useState<SharePerson[]>([])
    const [emailDraft, setEmailDraft] = useState('')
    const [permissionDraft, setPermissionDraft] = useState<SharePerson['permission']>('read')
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const requestedShareRef = useRef<string | null>(null)
    const qr = useMemo(() => (shareUrl ? createQrPath(shareUrl) : null), [shareUrl])

    useEffect(() => {
        function closeOnEscape(e: globalThis.KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [onClose])

    useEffect(() => {
        if (!item.is_public || !item.share_token) {
            if (requestedShareRef.current === item.id) return
            requestedShareRef.current = item.id
            void onEnableShare().catch((e) => {
                setError(e instanceof Error ? e.message : 'Could not generate share link.')
            })
        }
    }, [item.id, item.is_public, item.share_token, onEnableShare])

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

    function addPerson() {
        const email = emailDraft.trim().toLowerCase()
        setError(null)

        if (!EMAIL_PATTERN.test(email)) {
            setError('Enter a valid email address.')
            return
        }

        setPeople((current) => {
            if (current.some((person) => person.email === email)) return current
            return [...current, { email, permission: permissionDraft }]
        })
        setEmailDraft('')
    }

    function handleEmailKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        e.preventDefault()
        addPerson()
    }

    function updatePersonPermission(email: string, permission: SharePerson['permission']) {
        setPeople((current) =>
            current.map((person) => (person.email === email ? { ...person, permission } : person)),
        )
    }

    function removePerson(email: string) {
        setPeople((current) => current.filter((person) => person.email !== email))
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
                            <span className="eyebrow__dot" /> share file
                        </p>
                        <h2 id="share-title">{item.filename}</h2>
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
                            <strong>View only</strong>
                        </div>
                        <div className="share-modal__link-row">
                            <input value={shareUrl ?? 'Generating link...'} readOnly aria-label="Share link" />
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
                            <button className="btn btn--outline" type="button" onClick={() => void onEnableShare()} disabled={loading}>
                                Regenerate link
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
                            ) : (
                                <span className="spinner" />
                            )}
                        </div>
                    </section>

                    <section className="share-modal__panel share-modal__panel--people">
                        <div className="share-modal__section-head">
                            <h3>People with accounts</h3>
                            <span>{people.length}</span>
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
                            <button className="btn btn--solid" type="button" onClick={addPerson}>
                                Add
                            </button>
                        </div>
                        <div className="share-modal__people-list">
                            {people.length === 0 ? (
                                <p className="share-modal__empty">Add account email addresses to grant explicit permissions.</p>
                            ) : (
                                people.map((person) => (
                                    <div className="share-modal__person" key={person.email}>
                                        <span>{person.email}</span>
                                        <PermissionDropdown
                                            ariaLabel={`Permission for ${person.email}`}
                                            value={person.permission}
                                            onChange={(permission) => updatePersonPermission(person.email, permission)}
                                        />
                                        <button type="button" onClick={() => removePerson(person.email)} aria-label={`Remove ${person.email}`}>
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
