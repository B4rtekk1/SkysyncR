import { type ReactNode } from 'react'
import type { CalendarDropdownId } from '../calendarTypes'

type CalendarDropdownProps<T extends string> = {
    id: Exclude<CalendarDropdownId, null>
    label: string
    value: T
    options: Array<{ value: T; label: string; meta?: string }>
    openDropdown: CalendarDropdownId
    onOpenChange: (id: CalendarDropdownId) => void
    onChange: (value: T) => void
    emptyLabel?: string
    icon?: ReactNode
}

export function CalendarDropdown<T extends string>({
    id,
    label,
    value,
    options,
    openDropdown,
    onOpenChange,
    onChange,
    emptyLabel = 'Select',
    icon,
}: CalendarDropdownProps<T>) {
    const selected = options.find((option) => option.value === value)
    const isOpen = openDropdown === id

    return (
        <div className="calendar-dropdown">
            <span className="calendar-dropdown__label">{label}</span>
            <button
                className={`calendar-dropdown__trigger ${isOpen ? 'is-open' : ''}`}
                type="button"
                onClick={() => onOpenChange(isOpen ? null : id)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className="calendar-dropdown__icon" aria-hidden="true">
                    {icon ?? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                            <path d="M5 7h14M7 12h10M9 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                    )}
                </span>
                <span className="calendar-dropdown__value">{selected?.label ?? emptyLabel}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {isOpen && (
                <div className="calendar-dropdown__menu" role="listbox">
                    {options.map((option) => (
                        <button
                            className={`calendar-dropdown__option ${option.value === value ? 'is-selected' : ''}`}
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            onClick={() => {
                                onChange(option.value)
                                onOpenChange(null)
                            }}
                        >
                            <span>
                                {option.label}
                                {option.meta && <small>{option.meta}</small>}
                            </span>
                            {option.value === value && (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                        d="M5 12.5 9.3 17 19 7"
                                        stroke="currentColor"
                                        strokeWidth="1.9"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
