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
