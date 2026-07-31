import { useEffect, useMemo, useRef, useState } from 'react'
import {
    createDueReminderNotifications,
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    type Notification,
} from '../../../api/notifications'

type NotificationSummary = {
    title: string
    body: string
    tone: 'danger' | 'warning' | 'info'
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
    const value = payload[key]
    return typeof value === 'string' && value.trim() ? value : null
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
    const value = payload[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatRelativeTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'just now'
    const seconds = Math.round((date.getTime() - Date.now()) / 1000)
    const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', 60 * 60 * 24 * 365],
        ['month', 60 * 60 * 24 * 30],
        ['day', 60 * 60 * 24],
        ['hour', 60 * 60],
        ['minute', 60],
    ]
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    for (const [unit, unitSeconds] of ranges) {
        if (Math.abs(seconds) >= unitSeconds) return formatter.format(Math.round(seconds / unitSeconds), unit)
    }
    return formatter.format(seconds, 'second')
}

function notificationSummary(notification: Notification): NotificationSummary {
    const payload = notification.payload
    if (notification.type === 'security.ransomware_suspected') {
        const affected = payloadNumber(payload, 'affected_file_count')
        const device = payloadString(payload, 'device_label')
        return {
            title: 'Suspicious mass file activity',
            body: `${affected ?? 'Multiple'} affected file${affected === 1 ? '' : 's'}${device ? ` from ${device}` : ''}. Review recent changes.`,
            tone: 'danger',
        }
    }

    if (notification.type === 'security.new_login') {
        const device = payloadString(payload, 'device_label') ?? 'a device'
        const ip = payloadString(payload, 'ip_address')
        return {
            title: 'New login',
            body: ip ? `${device} signed in from ${ip}.` : `${device} signed in to your account.`,
            tone: 'warning',
        }
    }

    if (notification.type === 'calendar.reminder') {
        const kind = payloadString(payload, 'kind') === 'deadline' ? 'Deadline' : 'Calendar reminder'
        const title = payloadString(payload, 'title') ?? 'Untitled item'
        const date = payloadString(payload, 'date')
        const time = payloadString(payload, 'time')
        return {
            title: kind,
            body: `${title}${date ? ` is due ${date}${time ? ` at ${time}` : ''}` : ' is due soon'}.`,
            tone: kind === 'Deadline' ? 'warning' : 'info',
        }
    }

    if (notification.type === 'share.file_created' || notification.type === 'share.folder_created') {
        const item = notification.type === 'share.file_created' ? 'file' : 'folder'
        const permission = payloadString(payload, 'permission')
        return {
            title: `New shared ${item}`,
            body: `A ${item} was shared with you${permission ? ` with ${permission} access` : ''}.`,
            tone: 'info',
        }
    }

    return {
        title: notification.type.replaceAll('.', ' '),
        body: payloadString(payload, 'message') ?? 'Open the related area to review details.',
        tone: 'info',
    }
}

export function NotificationCenter() {
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<Notification[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const unreadCount = useMemo(() => items.filter((item) => !item.is_read).length, [items])

    async function refresh() {
        try {
            const next = await listNotifications({ limit: 50 })
            setItems(next)
            setError(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load notifications.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        let active = true
        async function load() {
            try {
                await createDueReminderNotifications()
            } catch {
                // Listing still surfaces security and share notifications if reminders fail.
            }
            if (active) await refresh()
        }
        void load()
        const timer = window.setInterval(() => {
            void refresh()
        }, 60_000)
        return () => {
            active = false
            window.clearInterval(timer)
        }
    }, [])

    useEffect(() => {
        if (!open) return
        function closeOnOutsideClick(event: MouseEvent) {
            if (panelRef.current?.contains(event.target as Node)) return
            setOpen(false)
        }
        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', closeOnOutsideClick)
        window.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick)
            window.removeEventListener('keydown', closeOnEscape)
        }
    }, [open])

    async function markOneRead(id: string) {
        const previous = items
        setItems((current) => current.map((item) => (item.id === id ? { ...item, is_read: true } : item)))
        try {
            const updated = await markNotificationRead(id)
            setItems((current) => current.map((item) => (item.id === id ? updated : item)))
        } catch (e) {
            setItems(previous)
            setError(e instanceof Error ? e.message : 'Could not mark notification read.')
        }
    }

    async function markAllRead() {
        const previous = items
        setItems((current) => current.map((item) => ({ ...item, is_read: true })))
        try {
            await markAllNotificationsRead()
        } catch (e) {
            setItems(previous)
            setError(e instanceof Error ? e.message : 'Could not mark notifications read.')
        }
    }

    return (
        <div className="notifications" ref={panelRef}>
            <button
                className={`notifications__trigger ${unreadCount > 0 ? 'has-unread' : ''}`}
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-label={`${unreadCount} unread notifications`}
                aria-expanded={open}
                title="Notifications"
            >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M15 17H9m9-2V11a6 6 0 0 0-12 0v4l-2 2h16l-2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                {unreadCount > 0 && <span className="notifications__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>

            {open && (
                <section className="notifications__panel" aria-label="Notification center">
                    <header className="notifications__head">
                        <div>
                            <h2>Notifications</h2>
                            <p>{unreadCount} unread</p>
                        </div>
                        <button className="notifications__mark-all" type="button" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
                            Mark all read
                        </button>
                    </header>

                    {error && <p className="notifications__error">{error}</p>}
                    {loading && <p className="notifications__empty">Loading...</p>}
                    {!loading && items.length === 0 && <p className="notifications__empty">No notifications</p>}
                    {!loading && items.length > 0 && (
                        <div className="notifications__list">
                            {items.map((item) => {
                                const summary = notificationSummary(item)
                                return (
                                    <article className={`notifications__item notifications__item--${summary.tone} ${item.is_read ? 'is-read' : ''}`} key={item.id}>
                                        <span className="notifications__dot" aria-hidden="true" />
                                        <div className="notifications__copy">
                                            <h3>{summary.title}</h3>
                                            <p>{summary.body}</p>
                                            <time dateTime={item.created_at}>{formatRelativeTime(item.created_at)}</time>
                                        </div>
                                        {!item.is_read && (
                                            <button className="notifications__read" type="button" onClick={() => void markOneRead(item.id)}>
                                                Mark read
                                            </button>
                                        )}
                                    </article>
                                )
                            })}
                        </div>
                    )}
                </section>
            )}
        </div>
    )
}
