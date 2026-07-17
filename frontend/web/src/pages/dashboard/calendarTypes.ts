import type { ApiFile } from '../../api/files'
import type { CalendarEntryKind } from '../../api/calendar'
import type { FileKind } from './fileUtils'

export type CalendarViewMode = 'month' | 'week'
export type CalendarSourceFilter = 'all' | 'root' | 'folders'
export type CalendarKindFilter = 'all' | FileKind
export type CalendarDropdownId = 'period' | 'kind' | 'source' | 'reminder' | 'file' | null

export type CalendarEntry = {
    id: string
    kind: CalendarEntryKind
    date: string
    time: string
    title: string
    note: string
    reminder: string
    fileId: string | null
}

export type CalendarDay = {
    date: Date
    key: string
    inMonth: boolean
    isToday: boolean
    files: ApiFile[]
    entries: CalendarEntry[]
}
