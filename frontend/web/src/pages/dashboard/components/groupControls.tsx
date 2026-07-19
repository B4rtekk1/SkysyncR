import { useEffect, useRef, useState } from 'react'
import type { GroupInviteRole } from '../types'
import { CHECK_ICON, ROLE_LABELS } from './groupIcons'

export function RoleDropdown({
    value,
    onChange,
    label,
}: {
    value: GroupInviteRole
    onChange: (role: GroupInviteRole) => void
    label: string
}) {
    const [open, setOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return

        function onClickAway(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false)
        }

        document.addEventListener('mousedown', onClickAway)
        window.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onClickAway)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    return (
        <div className="role-dropdown" ref={dropdownRef}>
            <button
                className={`role-dropdown__trigger ${open ? 'is-open' : ''}`}
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={label}
            >
                <span className={`groups-role groups-role--${value}`}>{ROLE_LABELS[value]}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="m7 10 5 5 5-5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {open && (
                <div className="role-dropdown__menu" role="listbox" aria-label={label}>
                    {(Object.keys(ROLE_LABELS) as GroupInviteRole[]).map((roleOption) => (
                        <button
                            key={roleOption}
                            className={`role-dropdown__option ${value === roleOption ? 'is-selected' : ''}`}
                            type="button"
                            role="option"
                            aria-selected={value === roleOption}
                            onClick={() => {
                                onChange(roleOption)
                                setOpen(false)
                            }}
                        >
                            <span className={`groups-role groups-role--${roleOption}`}>{ROLE_LABELS[roleOption]}</span>
                            {value === roleOption && CHECK_ICON}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
