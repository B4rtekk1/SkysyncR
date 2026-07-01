const url = 'http://localhost:3000/'

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
export interface LoginResponse {
  id: string
  token: string
}

export async function
registerUser(
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
): Promise<LoginResponse> {
  const res = await fetch(`${url}users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || 'Login failed')
  }

  return res.json()
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