const url = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

import { authenticatedFetch, saveTokens, type TokenPair } from './auth'
import { apiFetch } from './http'

export interface RegisterPayload {
  email: string
  display_name: string
  password: string
  public_key: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterResponse {
  id: string
}

export type LoginResponse = TokenPair

export interface CurrentUserResponse {
  id: string
  email: string
  display_name: string | null
  public_key: string | null
  trash_retention_days: number
}

export class ApiRequestError extends Error {
  status: number
  statusText: string

  constructor(status: number, statusText: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.statusText = statusText
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const body = (await res.json()) as { message?: unknown; error?: unknown }
      if (typeof body.message === 'string' && body.message.trim()) {
        return body.message
      }
      if (typeof body.error === 'string' && body.error.trim()) {
        return body.error
      }
    } catch {
      return fallback
    }
  }

  const message = await res.text()
  return message || fallback
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const message = await readErrorMessage(res, fallback)
  throw new ApiRequestError(res.status, res.statusText, message)
}

export async function registerUser(
  payload: RegisterPayload,
): Promise<RegisterResponse> {
  const res = await apiFetch(`${url}users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    await throwApiError(res, 'Registration failed')
  }

  return res.json()
}

export async function loginUser(
  payload: LoginPayload,
  remember = true,
): Promise<LoginResponse> {
  const res = await apiFetch(`${url}users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, remember }),
  })

  if (!res.ok) {
    await throwApiError(res, 'Login failed')
  }

  const tokens: LoginResponse = await res.json()
  saveTokens(tokens)
  return tokens
}

export async function verifyUser(token: string): Promise<void> {
  const res = await apiFetch(`${url}users/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })

  if (!res.ok) {
    await throwApiError(res, 'Verification failed')
  }
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  const res = await authenticatedFetch(`${url}users/me`, {
    method: 'GET',
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not load user profile')
  }

  return res.json()
}

export async function getCurrentUserWithAccessToken(accessToken: string): Promise<CurrentUserResponse> {
  const res = await apiFetch(`${url}users/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not load user profile')
  }

  return res.json()
}

export async function updateUserSettings(payload: { trash_retention_days: number }): Promise<{ trash_retention_days: number }> {
  const res = await authenticatedFetch(`${url}users/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not save settings')
  }

  return res.json()
}
