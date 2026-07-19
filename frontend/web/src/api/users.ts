const url = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

import { authenticatedFetch, saveTokens } from './auth'
import { apiFetch } from './http'
import type {
  ChangePasswordRequest as ChangePasswordPayload,
  CurrentUser as CurrentUserResponse,
  ForgotPasswordRequest as ForgotPasswordPayload,
  LoginRequest as LoginPayload,
  RegisterRequest as RegisterPayload,
  RegisterResponse,
  RecoveryBlob,
  ResetPasswordRequest as ResetPasswordPayload,
  TokenPair as LoginResponse,
  UserSettings as UserSettingsResponse,
  UserSettingsRequest as UserSettingsPayload,
} from './generated'
import {
  currentUser,
  parseApiErrorBody,
  readJson,
  recoveryBlob,
  registerResponse,
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
): Promise<LoginResponse> {
  const res = await apiFetch(`${url}users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, remember }),
  })

  if (!res.ok) {
    await throwApiError(res, 'Login failed')
  }

  const tokens = await readJson(res, tokenPair, 'LoginResponse')
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
