const url = 'http://localhost:3000/'

import { authenticatedFetch, saveTokens, type TokenPair } from './auth'
import { withDeviceHeaders } from './device'

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
  display_name: string | null
  public_key: string | null
}

export async function registerUser(
  payload: RegisterPayload,
): Promise<RegisterResponse> {
  const res = await fetch(`${url}users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || 'Registration failed')
  }

  return res.json()
}

export async function loginUser(
  payload: LoginPayload,
  remember = true,
): Promise<LoginResponse> {
  const res = await fetch(`${url}users/login`, {
    method: 'POST',
    headers: withDeviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || 'Login failed')
  }

  const tokens: LoginResponse = await res.json()
  saveTokens(tokens, remember)
  return tokens
}

export async function verifyUser(token: string): Promise<void> {
  const res = await fetch(`${url}users/verify?token=${token}`, {
    method: 'GET',
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || 'Verification failed')
  }
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  const res = await authenticatedFetch(`${url}users/me`, {
    method: 'GET',
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || 'Could not load user profile')
  }

  return res.json()
}
