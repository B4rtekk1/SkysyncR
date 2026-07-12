const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

import { deviceHeaders, withDeviceHeaders } from './device'
import { apiFetch } from './http'

const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const TOKEN_EXPIRES_AT_KEY = 'token_expires_at'
const REFRESH_LOCK_KEY = 'refresh_token_lock'
const REFRESH_LOCK_TTL_MS = 10_000
const REFRESH_WAIT_TIMEOUT_MS = 12_000

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
}

type StorageKind = 'local' | 'session'

type RefreshLock = {
  owner: string
  expiresAt: number
}

function randomId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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

function persistTokens(tokens: TokenPair) {
  const storage = getActiveStorage() ?? localStorage
  const expiresAt = Date.now() + tokens.expires_in * 1000
  storage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
  storage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAt))
}

async function requestTokenRefresh(refreshToken: string): Promise<string | null> {
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
  persistTokens(tokens)
  return tokens.access_token
}

function readRefreshLock(): RefreshLock | null {
  const raw = localStorage.getItem(REFRESH_LOCK_KEY)
  if (!raw) return null

  try {
    const lock = JSON.parse(raw) as Partial<RefreshLock>
    if (typeof lock.owner === 'string' && typeof lock.expiresAt === 'number') {
      return { owner: lock.owner, expiresAt: lock.expiresAt }
    }
  } catch {
    localStorage.removeItem(REFRESH_LOCK_KEY)
  }

  return null
}

function tryAcquireRefreshLock(owner: string): boolean {
  const now = Date.now()
  const lock = readRefreshLock()
  if (lock && lock.expiresAt > now && lock.owner !== owner) {
    return false
  }

  localStorage.setItem(
    REFRESH_LOCK_KEY,
    JSON.stringify({ owner, expiresAt: now + REFRESH_LOCK_TTL_MS }),
  )

  return readRefreshLock()?.owner === owner
}

function releaseRefreshLock(owner: string) {
  if (readRefreshLock()?.owner === owner) {
    localStorage.removeItem(REFRESH_LOCK_KEY)
  }
}

function shouldCoordinateRefresh(refreshToken: string): boolean {
  return localStorage.getItem(REFRESH_TOKEN_KEY) === refreshToken
}

function waitForRefreshedToken(previousRefreshToken: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false

    function finish(token: string | null) {
      if (done) return
      done = true
      window.removeEventListener('storage', check)
      window.clearInterval(interval)
      window.clearTimeout(timeout)
      resolve(token)
    }

    function check() {
      const current = getAccessToken()
      const refreshToken = getRefreshToken()
      if (current && refreshToken !== previousRefreshToken && !isAccessTokenExpiringSoon()) {
        finish(current)
      }
    }

    const interval = window.setInterval(check, 100)
    const timeout = window.setTimeout(() => finish(null), REFRESH_WAIT_TIMEOUT_MS)
    window.addEventListener('storage', check)
    check()
  })
}

async function refreshAccessToken(): Promise<string | null> {
  let refreshToken = getRefreshToken()
  if (!refreshToken) return null

  if (!shouldCoordinateRefresh(refreshToken)) {
    return requestTokenRefresh(refreshToken)
  }

  const owner = randomId()

  while (!tryAcquireRefreshLock(owner)) {
    const token = await waitForRefreshedToken(refreshToken)
    if (token) return token
  }

  try {
    const current = getAccessToken()
    if (current && !isAccessTokenExpiringSoon()) {
      return current
    }

    refreshToken = getRefreshToken()
    return refreshToken ? requestTokenRefresh(refreshToken) : null
  } finally {
    releaseRefreshLock(owner)
  }
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
