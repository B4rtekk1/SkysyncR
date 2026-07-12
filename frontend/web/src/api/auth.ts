const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

import { deviceHeaders, withDeviceHeaders } from './device'
import { apiFetch } from './http'

const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const TOKEN_EXPIRES_AT_KEY = 'token_expires_at'

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
}

type StorageKind = 'local' | 'session'

function getActiveStorage(): Storage | null {
  if (localStorage.getItem(ACCESS_TOKEN_KEY)) return localStorage
  if (sessionStorage.getItem(ACCESS_TOKEN_KEY)) return sessionStorage
  return null
}

function storageFor(kind: StorageKind): Storage {
  return kind === 'local' ? localStorage : sessionStorage
}

export function saveTokens(tokens: TokenPair, remember: boolean) {
  const storage = storageFor(remember ? 'local' : 'session')
  const other = storageFor(remember ? 'session' : 'local')

  other.removeItem(ACCESS_TOKEN_KEY)
  other.removeItem(REFRESH_TOKEN_KEY)
  other.removeItem(TOKEN_EXPIRES_AT_KEY)

  const expiresAt = Date.now() + tokens.expires_in * 1000
  storage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
  storage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAt))
}

export function clearTokens() {
  for (const key of [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, TOKEN_EXPIRES_AT_KEY]) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  }
}

export function getAccessToken(): string | null {
  return (
    localStorage.getItem(ACCESS_TOKEN_KEY) ??
    sessionStorage.getItem(ACCESS_TOKEN_KEY)
  )
}

function getRefreshToken(): string | null {
  return (
    localStorage.getItem(REFRESH_TOKEN_KEY) ??
    sessionStorage.getItem(REFRESH_TOKEN_KEY)
  )
}

function getTokenExpiresAt(): number | null {
  const raw =
    localStorage.getItem(TOKEN_EXPIRES_AT_KEY) ??
    sessionStorage.getItem(TOKEN_EXPIRES_AT_KEY)
  return raw ? Number(raw) : null
}

function isAccessTokenExpiringSoon(bufferMs = 60_000): boolean {
  const expiresAt = getTokenExpiresAt()
  if (!expiresAt) return true
  return Date.now() >= expiresAt - bufferMs
}

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  const res = await apiFetch(`${API_BASE}users/refresh`, {
    method: 'POST',
    headers: withDeviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  if (!res.ok) {
    clearTokens()
    return null
  }

  const tokens: TokenPair = await res.json()
  const storage = getActiveStorage() ?? localStorage
  const expiresAt = Date.now() + tokens.expires_in * 1000
  storage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
  storage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAt))

  return tokens.access_token
}

export async function getValidAccessToken(): Promise<string | null> {
  const current = getAccessToken()
  if (current && !isAccessTokenExpiringSoon()) {
    return current
  }

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

export async function authHeader(): Promise<HeadersInit> {
  const token = await getValidAccessToken()
  if (token) {
    return withDeviceHeaders({ Authorization: `Bearer ${token}` })
  }
  return deviceHeaders()
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()
  if (refreshToken) {
    try {
      await apiFetch(`${API_BASE}users/logout`, {
        method: 'POST',
        headers: withDeviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    } catch {
      // best-effort
    }
  }
  clearTokens()
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(withDeviceHeaders())
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value)
    })
  }

  const token = await getValidAccessToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await apiFetch(input, { ...init, headers })

  if (response.status === 401 && getRefreshToken()) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`)
      return apiFetch(input, { ...init, headers })
    }
  }

  return response
}
