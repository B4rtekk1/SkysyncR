export const NETWORK_ERROR_MESSAGE =
  'Could not connect to the server. Check your connection or make sure the API is running.'

export class NetworkError extends Error {
  constructor(message = NETWORK_ERROR_MESSAGE) {
    super(message)
    this.name = 'NetworkError'
  }
}

const DEVICE_ID_KEY = 'skysyncr_device_id'
const DEVICE_LABEL_KEY = 'skysyncr_device_label'
const DEVICE_ID_HEADER = 'x-skysyncr-device-id'
const DEVICE_LABEL_HEADER = 'x-skysyncr-device-label'

function randomDeviceId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing

    const id = randomDeviceId()
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return randomDeviceId()
  }
}

function defaultDeviceLabel(): string {
  const userAgent = navigator.userAgent
  const platform = navigator.platform

  if (/iPhone|Android.*Mobile|Windows Phone/i.test(userAgent)) return 'Phone'
  if (/iPad|Tablet|Android/i.test(userAgent)) return 'Tablet'
  if (/Mac|Win|Linux/i.test(platform) || /Macintosh|Windows|Linux/i.test(userAgent)) {
    return 'Laptop'
  }

  return 'Device'
}

export function getDeviceLabel(): string {
  try {
    const existing = localStorage.getItem(DEVICE_LABEL_KEY)?.trim()
    if (existing) return existing.slice(0, 80)

    const label = defaultDeviceLabel()
    localStorage.setItem(DEVICE_LABEL_KEY, label)
    return label
  } catch {
    return defaultDeviceLabel()
  }
}

export function setDeviceLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, ' ').slice(0, 80) || defaultDeviceLabel()
  try {
    localStorage.setItem(DEVICE_LABEL_KEY, normalized)
  } catch {
    // The request header can still use the in-memory value from this call.
  }
  return normalized
}

function withDeviceHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has(DEVICE_ID_HEADER)) {
    headers.set(DEVICE_ID_HEADER, getDeviceId())
  }
  if (!headers.has(DEVICE_LABEL_HEADER)) {
    headers.set(DEVICE_LABEL_HEADER, getDeviceLabel())
  }
  return { ...init, headers }
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, { credentials: 'include', ...withDeviceHeaders(init) })
  } catch (err) {
    if (err instanceof TypeError) {
      throw new NetworkError()
    }

    throw err
  }
}
