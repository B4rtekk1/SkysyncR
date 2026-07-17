import type { CalendarEntryKind } from '../../api/calendar'
import type { FileKind } from './fileUtils'
import type { CalendarEntry, CalendarKindFilter, CalendarSourceFilter, CalendarViewMode } from './calendarTypes'

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const CALENDAR_ENTRIES_STORAGE_KEY = 'calendar_entries'
export const KIND_OPTIONS: CalendarKindFilter[] = [
    'all',
    'image',
    'document',
    'pdf',
    'sheet',
    'presentation',
    'archive',
    'video',
    'audio',
    'text',
    'code',
    'file',
]
export const SOURCE_OPTIONS: Array<{ value: CalendarSourceFilter; label: string }> = [
    { value: 'all', label: 'All file locations' },
    { value: 'root', label: 'Root files' },
    { value: 'folders', label: 'Files in folders' },
]
export const REMINDER_OPTIONS = [
    { value: '', label: 'None' },
    { value: 'at-time', label: 'At time' },
    { value: '15m', label: '15 min before' },
    { value: '1h', label: '1 hour before' },
    { value: '1d', label: '1 day before' },
    { value: '1w', label: '1 week before' },
]
export const MONTH_LABELS = Array.from({ length: 12 }, (_, month) =>
    new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(2026, month, 1)),
)

export function toDateKey(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfWeek(date: Date) {
    const start = startOfDay(date)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return start
}

export function formatPeriod(date: Date, mode: CalendarViewMode) {
    if (mode === 'month') {
        return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)
    }

    const start = startOfWeek(date)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
    return `${formatter.format(start)} - ${formatter.format(end)}, ${end.getFullYear()}`
}

export function formatFullDate(date: Date) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)
}

export function formatTime(value: string) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function parseDateKey(value: string) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
}

export function loadCalendarEntries(): CalendarEntry[] {
    try {
        const raw = localStorage.getItem(CALENDAR_ENTRIES_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as Partial<CalendarEntry>[]

        return parsed
            .filter((entry): entry is CalendarEntry => {
                return (
                    typeof entry.id === 'string' &&
                    (entry.kind === 'event' || entry.kind === 'deadline') &&
                    typeof entry.date === 'string' &&
                    typeof entry.time === 'string' &&
                    typeof entry.title === 'string' &&
                    typeof entry.note === 'string' &&
                    typeof entry.reminder === 'string'
                )
            })
            .map((entry) => ({ ...entry, fileId: typeof entry.fileId === 'string' ? entry.fileId : null }))
    } catch {
        return []
    }
}

export function fromApiEntry(entry: {
    id: string
    kind: CalendarEntryKind
    date: string
    time: string
    title: string
    note: string
    reminder: string
    file_id: string | null
}): CalendarEntry {
    return {
        id: entry.id,
        kind: entry.kind,
        date: entry.date,
        time: entry.time.slice(0, 5),
        title: entry.title,
        note: entry.note,
        reminder: entry.reminder,
        fileId: entry.file_id,
    }
}

export function entryKey(entry: {
    kind: string
    date: string
    time: string
    title: string
    note: string
    reminder: string
    file_id?: string | null
    fileId?: string | null
}) {
    return [
        entry.kind,
        entry.date,
        entry.time.slice(0, 5),
        entry.title,
        entry.note,
        entry.reminder,
        entry.file_id ?? entry.fileId ?? '',
    ].join('\u001f')
}

export function isCalendarKind(value: string): value is FileKind {
    return KIND_OPTIONS.includes(value as CalendarKindFilter) && value !== 'all'
}
