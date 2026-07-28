export const NETWORK_ERROR_MESSAGE =
  'Could not connect to the server. Check your connection or make sure the API is running.'

export class NetworkError extends Error {
  constructor(message = NETWORK_ERROR_MESSAGE) {
    super(message)
    this.name = 'NetworkError'
  }
}

const DEVICE_ID_KEY = 'skysyncr_device_id'
const DEVICE_ID_HEADER = 'x-skysyncr-device-id'

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

function withDeviceHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has(DEVICE_ID_HEADER)) {
    headers.set(DEVICE_ID_HEADER, getDeviceId())
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
