const API_BASE = import.meta.env?.VITE_API_BASE ?? 'http://localhost:3000/'

import { apiFetch } from './http.ts'
import { clearActivePrivateKeys } from '../crypto/storage.ts'
import type { TokenPair } from './generated.ts'
import { readJson, tokenPair } from './validators.ts'

const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const TOKEN_EXPIRES_AT_KEY = 'token_expires_at'
const REFRESH_LOCK_KEY = 'refresh_token_lock'
const REFRESH_LOCK_TTL_MS = 10_000
const REFRESH_WAIT_TIMEOUT_MS = 12_000

export type { TokenPair }

type RefreshLock = {
  owner: string
  expiresAt: number
}

let accessToken: string | null = null
let accessTokenExpiresAt: number | null = null

function randomId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function clearLegacyStoredTokens() {
  for (const key of [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, TOKEN_EXPIRES_AT_KEY]) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  }
}

export function saveTokens(tokens: TokenPair) {
  accessToken = tokens.access_token
  accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000
  clearLegacyStoredTokens()
}

export function clearTokens() {
  accessToken = null
  accessTokenExpiresAt = null
  clearLegacyStoredTokens()
}

export function getAccessToken(): string | null {
  return accessToken
}

function getTokenExpiresAt(): number | null {
  return accessTokenExpiresAt
}

function isAccessTokenExpiringSoon(bufferMs = 60_000): boolean {
  const expiresAt = getTokenExpiresAt()
  if (!expiresAt) return true
  return Date.now() >= expiresAt - bufferMs
}

let refreshPromise: Promise<string | null> | null = null

function persistTokens(tokens: TokenPair) {
  accessToken = tokens.access_token
  accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000
  clearLegacyStoredTokens()
}

async function requestTokenRefresh(): Promise<string | null> {
  const res = await apiFetch(`${API_BASE}users/refresh`, {
    method: 'POST',
  })

  if (!res.ok) {
    clearTokens()
    return null
  }

  const tokens = await readJson(res, tokenPair, 'TokenPair')
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

function waitForRefreshLock(): Promise<void> {
  return new Promise((resolve) => {
    let done = false

    function finish() {
      if (done) return
      done = true
      window.removeEventListener('storage', check)
      window.clearInterval(interval)
      window.clearTimeout(timeout)
      resolve()
    }

    function check() {
      const lock = readRefreshLock()
      if (!lock || lock.expiresAt <= Date.now()) {
        finish()
      }
    }

    const interval = window.setInterval(check, 100)
    const timeout = window.setTimeout(finish, REFRESH_WAIT_TIMEOUT_MS)
    window.addEventListener('storage', check)
    check()
  })
}

async function refreshAccessToken(): Promise<string | null> {
  const owner = randomId()

  while (!tryAcquireRefreshLock(owner)) {
    await waitForRefreshLock()
    const current = getAccessToken()
    if (current && !isAccessTokenExpiringSoon()) return current
  }

  try {
    const current = getAccessToken()
    if (current && !isAccessTokenExpiringSoon()) {
      return current
    }

    return requestTokenRefresh()
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

export async function logout(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}users/logout`, {
      method: 'POST',
    })
  } catch {
    // best-effort
  }
  await clearActivePrivateKeys()
  clearTokens()
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers()
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

  if (response.status === 401) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`)
      return apiFetch(input, { ...init, headers })
    }
  }

  return response
}

clearLegacyStoredTokens()
