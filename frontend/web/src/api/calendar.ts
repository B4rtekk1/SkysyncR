import { authenticatedFetch } from './auth'
import type {
    CalendarEntry as CalendarEntryRecord,
    CalendarEntryKind,
    CalendarEntryRequest as CalendarEntryPayload,
} from './generated'
import {
    calendarEntries,
    calendarEntry,
    parseApiErrorBody,
    readJson,
} from './validators'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

export type { CalendarEntryKind, CalendarEntryPayload, CalendarEntryRecord }

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data: unknown = await response.json()
        return parseApiErrorBody(data) ?? 'An error occurred'
    } catch {
        return 'An error occurred'
    }
}

export async function listCalendarEntries(): Promise<CalendarEntryRecord[]> {
    const res = await authenticatedFetch(`${API_BASE}calendar-entries`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, calendarEntries, 'CalendarEntry[]')
}

export async function createCalendarEntry(payload: CalendarEntryPayload): Promise<CalendarEntryRecord> {
    const res = await authenticatedFetch(`${API_BASE}calendar-entries`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, calendarEntry, 'CalendarEntry')
}

export async function deleteCalendarEntry(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}calendar-entries/${id}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}
