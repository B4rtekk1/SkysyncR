const DEVICE_ID_KEY = 'device_id'

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }

  const deviceId = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, deviceId)
  return deviceId
}

export function deviceHeaders(): HeadersInit {
  return {
    'X-Device-Id': getOrCreateDeviceId(),
  }
}

export function withDeviceHeaders(headers: HeadersInit = {}): HeadersInit {
  return {
    ...deviceHeaders(),
    ...headers,
  }
}
