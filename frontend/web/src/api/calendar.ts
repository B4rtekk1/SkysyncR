import { authenticatedFetch } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

export type CalendarEntryKind = 'event' | 'deadline'

export type CalendarEntryRecord = {
    id: string
    kind: CalendarEntryKind
    date: string
    time: string
    title: string
    note: string
    reminder: string
    file_id: string | null
    created_at: string
    updated_at: string
}

export type CalendarEntryPayload = {
    kind: CalendarEntryKind
    date: string
    time: string
    title: string
    note: string
    reminder: string
    file_id: string | null
}

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data = await response.json()
        return data.message || 'An error occurred'
    } catch {
        return 'An error occurred'
    }
}

export async function listCalendarEntries(): Promise<CalendarEntryRecord[]> {
    const res = await authenticatedFetch(`${API_BASE}calendar-entries`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
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
    return res.json()
}

export async function deleteCalendarEntry(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}calendar-entries/${id}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}
