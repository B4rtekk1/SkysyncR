const url = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

import { authenticatedFetch, saveTokens } from './auth'
import { apiFetch } from './http'
import type {
  ChangePasswordRequest as ChangePasswordPayload,
  CurrentUser as CurrentUserResponse,
  ForgotPasswordRequest as ForgotPasswordPayload,
  LoginRequest as LoginPayload,
  OperationLogEntry,
  OperationLogResponse,
  RegisterRequest as RegisterPayload,
  RegisterResponse,
  RecoveryBlob,
  ResetPasswordRequest as ResetPasswordPayload,
  SessionsResponse,
  TokenPair as LoginResponse,
  UserSettings as UserSettingsResponse,
  UserSettingsRequest as UserSettingsPayload,
} from './generated'
import {
  currentUser,
  operationLogResponse,
  parseApiErrorBody,
  readJson,
  recoveryBlob,
  registerResponse,
  sessionsResponse,
  tokenPair,
  userSettings,
} from './validators'

export type {
  CurrentUserResponse,
  LoginPayload,
  LoginResponse,
  RegisterPayload,
  RegisterResponse,
  UserSettingsPayload,
  UserSettingsResponse,
  ChangePasswordPayload,
  ForgotPasswordPayload,
  RecoveryBlob,
  ResetPasswordPayload,
  SessionsResponse,
  OperationLogResponse,
  OperationLogEntry,
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

export type TotpLoginRequired = { totp_required: true; challenge_id: string }
export type TotpSetup = { secret: string; otpauth_url: string }
export type TotpStatus = { enabled: boolean; pending: boolean }
export type ReauthenticationPayload = {
  password: string
  totp_code?: string | null
}

function parseTotpStatus(value: unknown): TotpStatus {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { enabled?: unknown }).enabled !== 'boolean' ||
    typeof (value as { pending?: unknown }).pending !== 'boolean'
  ) {
    throw new Error('Invalid TOTP status response')
  }

  return value as TotpStatus
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const body: unknown = await res.json()
      return parseApiErrorBody(body) ?? fallback
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

  return readJson(res, registerResponse, 'RegisterResponse')
}

export async function loginUser(
  payload: LoginPayload,
  remember = true,
): Promise<LoginResponse | TotpLoginRequired> {
  const res = await apiFetch(`${url}users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, remember }),
  })

  if (!res.ok) {
    await throwApiError(res, 'Login failed')
  }

  const body: unknown = await res.json()
  if (typeof body === 'object' && body !== null && (body as { totp_required?: unknown }).totp_required === true) {
    const challengeId = (body as { challenge_id?: unknown }).challenge_id
    if (typeof challengeId !== 'string') throw new Error('Invalid two-factor login response')
    return { totp_required: true, challenge_id: challengeId }
  }
  const tokens = tokenPair(body, 'LoginResponse')
  saveTokens(tokens)
  return tokens
}

export async function loginWithTotp(challengeId: string, code: string): Promise<LoginResponse> {
  const res = await apiFetch(`${url}users/login/totp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  })
  if (!res.ok) await throwApiError(res, 'Two-factor verification failed')
  const tokens = await readJson(res, tokenPair, 'LoginResponse')
  saveTokens(tokens)
  return tokens
}

export async function getTotpStatus(): Promise<TotpStatus> {
  const res = await authenticatedFetch(`${url}users/totp`)
  if (!res.ok) await throwApiError(res, 'Could not load two-factor authentication status')
  return parseTotpStatus(await res.json())
}

export async function setupTotp(): Promise<TotpSetup> {
  const res = await authenticatedFetch(`${url}users/totp`, { method: 'POST' })
  if (!res.ok) await throwApiError(res, 'Could not start two-factor setup')
  const value: unknown = await res.json()
  if (typeof value !== 'object' || value === null || typeof (value as TotpSetup).secret !== 'string' || typeof (value as TotpSetup).otpauth_url !== 'string') throw new Error('Invalid TOTP setup response')
  return value as TotpSetup
}

export async function confirmTotp(code: string): Promise<TotpStatus> {
  const res = await authenticatedFetch(`${url}users/totp/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!res.ok) await throwApiError(res, 'Could not enable two-factor authentication')
  return parseTotpStatus(await res.json())
}

export async function disableTotp(code: string): Promise<TotpStatus> {
  const res = await authenticatedFetch(`${url}users/totp`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!res.ok) await throwApiError(res, 'Could not disable two-factor authentication')
  return parseTotpStatus(await res.json())
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

export async function resendVerificationEmail(email: string): Promise<void> {
  const res = await apiFetch(`${url}users/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not send verification email')
  }
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  const res = await authenticatedFetch(`${url}users/me`, {
    method: 'GET',
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not load user profile')
  }

  return readJson(res, currentUser, 'CurrentUserResponse')
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

  return readJson(res, currentUser, 'CurrentUserResponse')
}

export async function updateUserSettings(payload: UserSettingsPayload): Promise<UserSettingsResponse> {
  const res = await authenticatedFetch(`${url}users/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not save settings')
  }

  return readJson(res, userSettings, 'UserSettingsResponse')
}

export async function changePassword(payload: ChangePasswordPayload): Promise<LoginResponse> {
  const res = await authenticatedFetch(`${url}users/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not change password')
  }

  const tokens = await readJson(res, tokenPair, 'ChangePasswordResponse')
  saveTokens(tokens)
  return tokens
}

export async function getSessions(): Promise<SessionsResponse> {
  const res = await authenticatedFetch(`${url}users/sessions`, {
    method: 'GET',
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not load sessions')
  }

  return readJson(res, sessionsResponse, 'SessionsResponse')
}

export async function getOperationLog(): Promise<OperationLogResponse> {
  const res = await authenticatedFetch(`${url}users/operation-log`, {
    method: 'GET',
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not load operation log')
  }

  return readJson(res, operationLogResponse, 'OperationLogResponse')
}

export async function downloadUserDataExport(reauth: ReauthenticationPayload): Promise<void> {
  const res = await authenticatedFetch(`${url}users/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reauth),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not prepare data export')
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const filenameMatch = /filename="([^"]+)"/.exec(disposition)
  const filename = filenameMatch?.[1] ?? `skysyncr-user-export-${new Date().toISOString().slice(0, 10)}.tar`
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}

export async function revokeSession(sessionId: string): Promise<void> {
  const res = await authenticatedFetch(`${url}users/sessions/${sessionId}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not sign out this session')
  }
}

export async function updateSessionTrust(sessionId: string, trusted: boolean): Promise<void> {
  const res = await authenticatedFetch(`${url}users/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trusted }),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not update trusted device')
  }
}

export async function forgotPassword(payload: ForgotPasswordPayload): Promise<void> {
  const res = await apiFetch(`${url}users/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not request password reset')
  }
}

export async function getRecoveryBlob(token: string): Promise<RecoveryBlob> {
  const params = new URLSearchParams({ token })
  const res = await apiFetch(`${url}users/recovery-blob?${params.toString()}`, {
    method: 'GET',
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not load recovery data')
  }

  return readJson(res, recoveryBlob, 'RecoveryBlob')
}

export async function resetPassword(payload: ResetPasswordPayload): Promise<void> {
  const res = await apiFetch(`${url}users/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    await throwApiError(res, 'Could not reset password')
  }
}
