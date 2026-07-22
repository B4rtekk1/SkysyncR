import { useEffect, useMemo, useState, type SubmitEvent } from 'react'
import type { ApiFile } from '../../../api/files'
import {
    createCalendarEntry,
    deleteCalendarEntry,
    listCalendarEntries,
    updateCalendarEntry,
    type CalendarEntryKind,
} from '../../../api/calendar'
import { formatBytes, kindFromFile, KIND_LABELS } from '../fileUtils'
import { CalendarDropdown } from './CalendarDropdown'
import type {
    CalendarDay,
    CalendarDropdownId,
    CalendarEntry,
    CalendarKindFilter,
    CalendarSourceFilter,
    CalendarViewMode,
} from '../calendarTypes'
import {
    DAY_LABELS,
    CALENDAR_ENTRIES_STORAGE_KEY,
    KIND_OPTIONS,
    MONTH_LABELS,
    REMINDER_OPTIONS,
    SOURCE_OPTIONS,
    entryKey,
    formatFullDate,
    formatPeriod,
    formatTime,
    fromApiEntry,
    loadCalendarEntries,
    parseDateKey,
    startOfDay,
    startOfWeek,
    toDateKey,
} from '../calendarUtils'

type CalendarPanelProps = {
    files: ApiFile[]
    onPreview: (item: ApiFile) => void
    onDownload: (item: ApiFile) => void
}

export function CalendarPanel({ files, onPreview, onDownload }: CalendarPanelProps) {
    const today = useMemo(() => startOfDay(new Date()), [])
    const [viewMode, setViewMode] = useState<CalendarViewMode>('month')
    const [visibleDate, setVisibleDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
    const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(today))
    const [kindFilter, setKindFilter] = useState<CalendarKindFilter>('all')
    const [sourceFilter, setSourceFilter] = useState<CalendarSourceFilter>('all')
    const [entries, setEntries] = useState<CalendarEntry[]>(() => loadCalendarEntries())
    const [entryKind, setEntryKind] = useState<CalendarEntryKind>('event')
    const [entryTitle, setEntryTitle] = useState('')
    const [entryNote, setEntryNote] = useState('')
    const [entryTime, setEntryTime] = useState('09:00')
    const [entryReminder, setEntryReminder] = useState('')
    const [entryFileId, setEntryFileId] = useState('')
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
    const [openDropdown, setOpenDropdown] = useState<CalendarDropdownId>(null)
    const [entrySyncError, setEntrySyncError] = useState<string | null>(null)

    const filteredFiles = useMemo(() => {
        return files.filter((file) => {
            return (
                (kindFilter === 'all' || kindFromFile(file.filename, file.mime_type) === kindFilter) &&
                (sourceFilter !== 'root' || file.folder_id === null) &&
                (sourceFilter !== 'folders' || file.folder_id !== null)
            )
        })
    }, [files, kindFilter, sourceFilter])

    const filesByDate = useMemo(() => {
        const grouped = new Map<string, ApiFile[]>()
        filteredFiles.forEach((file) => {
            const key = toDateKey(new Date(file.updated_at))
            grouped.set(key, [...(grouped.get(key) ?? []), file])
        })
        grouped.forEach((items) => {
            items.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        })
        return grouped
    }, [filteredFiles])

    const entriesByDate = useMemo(() => {
        const grouped = new Map<string, CalendarEntry[]>()
        entries.forEach((entry) => {
            grouped.set(entry.date, [...(grouped.get(entry.date) ?? []), entry])
        })
        grouped.forEach((items) => {
            items.sort((a, b) => a.time.localeCompare(b.time))
        })
        return grouped
    }, [entries])

    const days = useMemo<CalendarDay[]>(() => {
        const gridLength = viewMode === 'month' ? 42 : 7
        const gridStart =
            viewMode === 'month'
                ? startOfWeek(new Date(visibleDate.getFullYear(), visibleDate.getMonth(), 1))
                : startOfWeek(visibleDate)

        return Array.from({ length: gridLength }, (_, index) => {
            const date = new Date(gridStart)
            date.setDate(gridStart.getDate() + index)
            const key = toDateKey(date)

            return {
                date,
                key,
                inMonth: viewMode === 'week' || date.getMonth() === visibleDate.getMonth(),
                isToday: key === toDateKey(today),
                files: filesByDate.get(key) ?? [],
                entries: entriesByDate.get(key) ?? [],
            }
        })
    }, [entriesByDate, filesByDate, today, viewMode, visibleDate])

    const selectedDate = useMemo(() => parseDateKey(selectedDateKey), [selectedDateKey])
    const selectedFiles = filesByDate.get(selectedDateKey) ?? []
    const selectedEntries = entriesByDate.get(selectedDateKey) ?? []
    const linkedFile = entryFileId ? files.find((file) => file.id === entryFileId) ?? null : null
    const kindOptions = useMemo(
        () =>
            KIND_OPTIONS.map((kind) => ({
                value: kind,
                label: kind === 'all' ? 'All types' : KIND_LABELS[kind],
            })),
        [],
    )
    const fileOptions = useMemo(
        () => [
            { value: '', label: 'No linked file' },
            ...filteredFiles.map((file) => ({
                value: file.id,
                label: file.filename,
                meta: `${KIND_LABELS[kindFromFile(file.filename, file.mime_type)]} · ${formatBytes(file.size_bytes)}`,
            })),
        ],
        [filteredFiles],
    )

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') setOpenDropdown(null)
        }

        function onPointerDown(event: MouseEvent) {
            const target = event.target as HTMLElement
            if (!target.closest('.calendar-dropdown') && !target.closest('.calendar-panel__period-picker')) {
                setOpenDropdown(null)
            }
        }

        window.addEventListener('keydown', onKeyDown)
        document.addEventListener('mousedown', onPointerDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('mousedown', onPointerDown)
        }
    }, [])

    useEffect(() => {
        let active = true

        async function loadSyncedEntries() {
            try {
                setEntrySyncError(null)
                const remoteEntries = await listCalendarEntries()
                if (!active) return

                const localEntries = loadCalendarEntries()
                if (localEntries.length === 0) {
                    setEntries(remoteEntries.map(fromApiEntry))
                    return
                }

                const remoteKeys = new Set(remoteEntries.map(entryKey))
                const entriesToMigrate = localEntries.filter((entry) => !remoteKeys.has(entryKey(entry)))
                const migrated = await Promise.all(
                    entriesToMigrate.map((entry) =>
                        createCalendarEntry({
                            kind: entry.kind,
                            date: entry.date,
                            time: entry.time.slice(0, 5),
                            title: entry.title,
                            note: entry.note,
                            reminder: entry.reminder,
                            file_id: entry.fileId,
                        }),
                    ),
                )

                localStorage.removeItem(CALENDAR_ENTRIES_STORAGE_KEY)
                if (active) setEntries([...remoteEntries, ...migrated].map(fromApiEntry))
            } catch (error) {
                if (active) {
                    setEntrySyncError(error instanceof Error ? error.message : 'Could not sync calendar entries.')
                    setEntries(loadCalendarEntries())
                }
            }
        }

        void loadSyncedEntries()

        return () => {
            active = false
        }
    }, [])

    function shiftPeriod(offset: number) {
        setVisibleDate((current) => {
            const next =
                viewMode === 'month'
                    ? new Date(current.getFullYear(), current.getMonth() + offset, 1)
                    : new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset * 7)
            setSelectedDateKey(toDateKey(next))
            return next
        })
    }

    function showToday() {
        setVisibleDate(viewMode === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : today)
        setSelectedDateKey(toDateKey(today))
    }

    function selectMonth(month: number) {
        const next = new Date(visibleDate.getFullYear(), month, 1)
        setVisibleDate(next)
        setSelectedDateKey(toDateKey(next))
        setOpenDropdown(null)
    }

    function shiftYear(offset: number) {
        setVisibleDate((current) => {
            const next = new Date(current.getFullYear() + offset, current.getMonth(), 1)
            setSelectedDateKey(toDateKey(next))
            return next
        })
    }

    function selectDay(day: CalendarDay) {
        setSelectedDateKey(day.key)
        if (viewMode === 'week') setVisibleDate(day.date)
    }

    function resetEntryForm() {
        setEntryKind('event')
        setEntryTitle('')
        setEntryNote('')
        setEntryTime('09:00')
        setEntryReminder('')
        setEntryFileId('')
        setEditingEntryId(null)
        setOpenDropdown(null)
    }

    function editEntry(entry: CalendarEntry) {
        setEditingEntryId(entry.id)
        setEntryKind(entry.kind)
        setEntryTitle(entry.title)
        setEntryNote(entry.note)
        setEntryTime(entry.time)
        setEntryReminder(entry.reminder)
        setEntryFileId(entry.fileId ?? '')
        setSelectedDateKey(entry.date)
        setEntrySyncError(null)
        setOpenDropdown(null)
    }

    async function handleSaveEntry(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        const title = entryTitle.trim() || (linkedFile ? linkedFile.filename : '')
        if (!title) return
        const payload = {
            kind: entryKind,
            date: selectedDateKey,
            time: entryTime,
            title,
            note: entryNote.trim(),
            reminder: entryReminder,
            file_id: entryFileId || null,
        }

        try {
            setEntrySyncError(null)
            if (editingEntryId) {
                const updated = await updateCalendarEntry(editingEntryId, payload)
                setEntries((current) => current.map((entry) => (entry.id === editingEntryId ? fromApiEntry(updated) : entry)))
            } else {
                const created = await createCalendarEntry(payload)
                setEntries((current) => [...current, fromApiEntry(created)])
            }

            resetEntryForm()
        } catch (error) {
            setEntrySyncError(error instanceof Error ? error.message : 'Could not save calendar entry.')
        }
    }

    async function deleteEntry(id: string) {
        const previousEntries = entries
        setEntries((current) => current.filter((entry) => entry.id !== id))

        try {
            setEntrySyncError(null)
            await deleteCalendarEntry(id)
            if (editingEntryId === id) resetEntryForm()
        } catch (error) {
            setEntries(previousEntries)
            setEntrySyncError(error instanceof Error ? error.message : 'Could not delete calendar entry.')
        }
    }


    return (
        <section className="calendar-panel" aria-label="Calendar">
            <div className="calendar-panel__toolbar">
                <div className="calendar-panel__period">
                    <button type="button" onClick={() => shiftPeriod(-1)} aria-label="Previous period">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <div className="calendar-panel__period-picker">
                        <button
                            className={`calendar-panel__period-trigger ${openDropdown === 'period' ? 'is-open' : ''}`}
                            type="button"
                            onClick={() => setOpenDropdown(openDropdown === 'period' ? null : 'period')}
                            aria-haspopup="dialog"
                            aria-expanded={openDropdown === 'period'}
                        >
                            {formatPeriod(visibleDate, viewMode)}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>

                        {openDropdown === 'period' && (
                            <div className="calendar-panel__period-menu" role="dialog" aria-label="Choose month and year">
                                <div className="calendar-panel__year-row">
                                    <button type="button" onClick={() => shiftYear(-1)} aria-label="Previous year">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </button>
                                    <strong>{visibleDate.getFullYear()}</strong>
                                    <button type="button" onClick={() => shiftYear(1)} aria-label="Next year">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </button>
                                </div>
                                <div className="calendar-panel__month-grid">
                                    {MONTH_LABELS.map((label, month) => (
                                        <button
                                            className={visibleDate.getMonth() === month ? 'is-selected' : ''}
                                            key={label}
                                            type="button"
                                            onClick={() => selectMonth(month)}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <button type="button" onClick={() => shiftPeriod(1)} aria-label="Next period">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>

                <div className="calendar-panel__controls">
                    <div className="calendar-panel__segments" role="group" aria-label="Calendar view">
                        <button
                            className={viewMode === 'month' ? 'is-active' : ''}
                            type="button"
                            onClick={() => setViewMode('month')}
                        >
                            Month
                        </button>
                        <button
                            className={viewMode === 'week' ? 'is-active' : ''}
                            type="button"
                            onClick={() => {
                                setViewMode('week')
                                setVisibleDate(selectedDate)
                            }}
                        >
                            Week
                        </button>
                    </div>
                    <button className="calendar-panel__today" type="button" onClick={showToday}>
                        Today
                    </button>
                </div>
            </div>

            <div className="calendar-panel__filters">
                <CalendarDropdown
                    id="kind"
                    label="Type"
                    value={kindFilter}
                    options={kindOptions}
                    openDropdown={openDropdown}
                    onOpenChange={setOpenDropdown}
                    onChange={setKindFilter}
                />
                <CalendarDropdown
                    id="source"
                    label="Folder sync"
                    value={sourceFilter}
                    options={SOURCE_OPTIONS}
                    openDropdown={openDropdown}
                    onOpenChange={setOpenDropdown}
                    onChange={setSourceFilter}
                    icon={
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                            <path d="M4 6.5h6l2 2.5h8v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                    }
                />
            </div>

            <div className="calendar-panel__layout">
                <div className={`calendar-panel__grid calendar-panel__grid--${viewMode}`} role="grid" aria-label={formatPeriod(visibleDate, viewMode)}>
                    {DAY_LABELS.map((label) => (
                        <span className="calendar-panel__weekday" key={label}>
                            {label}
                        </span>
                    ))}
                    {days.map((day) => (
                        <button
                            className={`calendar-panel__day ${day.inMonth ? '' : 'is-muted'} ${
                                day.isToday ? 'is-today' : ''
                            } ${selectedDateKey === day.key ? 'is-selected' : ''}`}
                            key={day.key}
                            type="button"
                            onClick={() => selectDay(day)}
                            role="gridcell"
                            aria-selected={selectedDateKey === day.key}
                        >
                            <span className="calendar-panel__day-number">{day.date.getDate()}</span>
                            <span className="calendar-panel__badges">
                                {day.files.length > 0 && (
                                    <span className="calendar-panel__day-count" aria-label={`${day.files.length} files`}>
                                        {day.files.length} files
                                    </span>
                                )}
                                {day.entries.length > 0 && (
                                    <span className="calendar-panel__day-count calendar-panel__day-count--entry" aria-label={`${day.entries.length} entries`}>
                                        {day.entries.length} plans
                                    </span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>

                <aside className="calendar-panel__agenda" aria-label="Selected day details">
                    <div className="calendar-panel__agenda-head">
                        <strong>{formatFullDate(selectedDate)}</strong>
                        <span>{selectedFiles.length} files</span>
                    </div>

                    <form className="calendar-panel__form" onSubmit={handleSaveEntry}>
                        {entrySyncError && (
                            <p className="calendar-panel__sync-error" role="alert">
                                {entrySyncError}
                            </p>
                        )}
                        <div className="calendar-panel__segments" role="group" aria-label="Entry type">
                            <button
                                className={entryKind === 'event' ? 'is-active' : ''}
                                type="button"
                                onClick={() => setEntryKind('event')}
                            >
                                Event
                            </button>
                            <button
                                className={entryKind === 'deadline' ? 'is-active' : ''}
                                type="button"
                                onClick={() => setEntryKind('deadline')}
                            >
                                Deadline
                            </button>
                        </div>
                        <input value={entryTitle} onChange={(event) => setEntryTitle(event.target.value)} placeholder={entryKind === 'event' ? 'Event title' : 'Deadline title'} />
                        <textarea value={entryNote} onChange={(event) => setEntryNote(event.target.value)} placeholder="Note" rows={3} />
                        <div className="calendar-panel__form-row">
                            <label>
                                <span>Time</span>
                                <input type="time" value={entryTime} onChange={(event) => setEntryTime(event.target.value)} />
                            </label>
                            <CalendarDropdown
                                id="reminder"
                                label="Reminder"
                                value={entryReminder}
                                options={REMINDER_OPTIONS}
                                openDropdown={openDropdown}
                                onOpenChange={setOpenDropdown}
                                onChange={setEntryReminder}
                                icon={
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                        <path d="M12 6v6l3.5 2M5 4.5 3.5 6M19 4.5 20.5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                        <circle cx="12" cy="13" r="7" stroke="currentColor" strokeWidth="1.5" />
                                    </svg>
                                }
                            />
                        </div>
                        <CalendarDropdown
                            id="file"
                            label="Linked file"
                            value={entryFileId}
                            options={fileOptions}
                            openDropdown={openDropdown}
                            onOpenChange={setOpenDropdown}
                            onChange={setEntryFileId}
                            icon={
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                    <path d="M6.5 4.5h8.2L18 7.8v11.7H6.5v-15Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                    <path d="M14.5 4.8V8h3.2M9 12h6M9 15.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                </svg>
                            }
                        />
                        <div className="calendar-panel__form-actions">
                            {editingEntryId && (
                                <button className="calendar-panel__secondary" type="button" onClick={resetEntryForm}>
                                    Cancel
                                </button>
                            )}
                            <button className="calendar-panel__submit" type="submit">
                                {editingEntryId ? 'Save changes' : `Add ${entryKind}`}
                            </button>
                        </div>
                    </form>

                    <div className="calendar-panel__section">
                        <h2>Plans</h2>
                        {selectedEntries.length === 0 ? (
                            <p className="calendar-panel__empty">No events, deadlines, or reminders for this day.</p>
                        ) : (
                            <div className="calendar-panel__events">
                                {selectedEntries.map((entry) => {
                                    const file = entry.fileId ? files.find((item) => item.id === entry.fileId) ?? null : null

                                    return (
                                        <article className={`calendar-panel__event calendar-panel__event--${entry.kind}`} key={entry.id}>
                                            <div>
                                                <strong title={entry.title}>{entry.title}</strong>
                                                <span>
                                                    {entry.time} · {entry.kind === 'deadline' ? 'Deadline' : 'Event'}
                                                    {entry.reminder ? ` · Reminder ${entry.reminder}` : ''}
                                                </span>
                                                {entry.note && <p>{entry.note}</p>}
                                                {file && <em>Linked: {file.filename}</em>}
                                            </div>
                                            <div className="calendar-panel__event-actions">
                                                {file && (
                                                    <button type="button" onClick={() => onPreview(file)}>
                                                        Preview
                                                    </button>
                                                )}
                                                <button type="button" onClick={() => editEntry(entry)}>
                                                    Edit
                                                </button>
                                                <button type="button" onClick={() => void deleteEntry(entry.id)}>
                                                    Delete
                                                </button>
                                            </div>
                                        </article>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="calendar-panel__section">
                        <h2>File activity</h2>
                        {selectedFiles.length === 0 ? (
                            <p className="calendar-panel__empty">No file activity for this day.</p>
                        ) : (
                            <div className="calendar-panel__events">
                                {selectedFiles.map((file) => {
                                    const kind = kindFromFile(file.filename, file.mime_type)

                                    return (
                                        <article className="calendar-panel__event" key={file.id}>
                                            <div>
                                                <strong title={file.filename}>{file.filename}</strong>
                                                <span>
                                                    {formatTime(file.updated_at)} · {KIND_LABELS[kind]} · {formatBytes(file.size_bytes)}
                                                </span>
                                            </div>
                                            <div className="calendar-panel__event-actions">
                                                <button type="button" onClick={() => onPreview(file)}>
                                                    Preview
                                                </button>
                                                <button type="button" onClick={() => onDownload(file)}>
                                                    Download
                                                </button>
                                            </div>
                                        </article>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </section>
    )
}
