const url = 'http://localhost:3000/'

export interface RegisterPayload {
  email: string
  display_name: string
  password: string
  public_key: string
}

export interface RegisterResponse {
  id: string
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
