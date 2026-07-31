import { authenticatedFetch } from './auth'
import type { Notification } from './generated'
import { notifications, notification, parseApiErrorBody, readJson } from './validators'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    return parseApiErrorBody(data) ?? 'An error occurred'
  } catch {
    return 'An error occurred'
  }
}

export type { Notification }

export async function listNotifications(options: {
  unreadOnly?: boolean
  limit?: number
} = {}): Promise<Notification[]> {
  const params = new URLSearchParams()
  if (options.unreadOnly) params.set('unread_only', 'true')
  if (options.limit) params.set('limit', String(options.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''

  const res = await authenticatedFetch(`${API_BASE}notifications${qs}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  return readJson(res, notifications, 'Notification[]')
}

export async function createDueReminderNotifications(): Promise<Notification[]> {
  const res = await authenticatedFetch(`${API_BASE}notifications/reminders/due`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  return readJson(res, notifications, 'Notification[]')
}

export async function markNotificationRead(id: string): Promise<Notification> {
  const res = await authenticatedFetch(`${API_BASE}notifications/${encodeURIComponent(id)}/read`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  return readJson(res, notification, 'Notification')
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await authenticatedFetch(`${API_BASE}notifications/read-all`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
}

function parseSseMessage(raw: string): { event: string; data: string } | null {
  let event = 'message'
  const data: string[] = []

  for (const line of raw.split('\n')) {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!clean || clean.startsWith(':')) continue

    const separator = clean.indexOf(':')
    const field = separator === -1 ? clean : clean.slice(0, separator)
    const value = separator === -1 ? '' : clean.slice(separator + 1).replace(/^ /, '')

    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }

  if (data.length === 0) return null
  return { event, data: data.join('\n') }
}

type NotificationStreamHandlers = {
  signal: AbortSignal
  onNotification: (notification: Notification) => void
  onSync: () => void
}

export async function subscribeToNotificationStream({
  signal,
  onNotification,
  onSync,
}: NotificationStreamHandlers): Promise<void> {
  const res = await authenticatedFetch(`${API_BASE}notifications/stream`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  if (!res.body) throw new Error('Notification stream is unavailable.')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value

      const chunks = buffer.split(/\n\n|\r\n\r\n/)
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const message = parseSseMessage(chunk)
        if (!message) continue
        if (message.event === 'sync') {
          onSync()
          continue
        }
        if (message.event === 'notification') {
          onNotification(notification(JSON.parse(message.data), 'NotificationStream'))
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
