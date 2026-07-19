import { useRef, useState, type FocusEvent } from 'react'
import type { FileSharePermission } from '../../../api/files'

export const DEFAULT_SHARE_DURATION_SECONDS = 60 * 60 * 24 * 7

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

export function PermissionDropdown({
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
    const selected = PERMISSION_OPTIONS.find((option) => option.value === value) ?? PERMISSION_OPTIONS[0]!

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

export function ShareDurationDropdown({
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
    const selected = SHARE_DURATION_OPTIONS.find((option) => option.value === value) ?? SHARE_DURATION_OPTIONS[2]!

    function handleBlur(e: FocusEvent<HTMLDivElement>) {
        const nextTarget = e.relatedTarget
        if (!nextTarget || !e.currentTarget.contains(nextTarget as Node)) {
            setOpen(false)
        }
    }

    return (
        <div className={`share-permission share-duration ${open ? 'is-open' : ''}`} ref={rootRef} onBlur={handleBlur}>
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
