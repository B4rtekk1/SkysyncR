import { getAccessToken, getValidAccessToken } from './auth'
import { getCurrentUser, getCurrentUserWithAccessToken, type CurrentUserResponse } from './users'
import { loadActivePrivateKey } from '../crypto/storage'

export type UnlockedVaultSession = {
  user: CurrentUserResponse
  privateKey: CryptoKey
}

type GetUnlockedVaultSessionOptions = {
  allowRefresh?: boolean
}

let cachedUnlockedSession: UnlockedVaultSession | null = null

export function setUnlockedVaultSession(session: UnlockedVaultSession | null) {
  cachedUnlockedSession = session
}

export async function getUnlockedVaultSession(
  options: GetUnlockedVaultSessionOptions = {},
): Promise<UnlockedVaultSession | null> {
  const allowRefresh = options.allowRefresh ?? true
  if (cachedUnlockedSession && getAccessToken()) {
    return cachedUnlockedSession
  }

  const token = allowRefresh ? await getValidAccessToken() : getAccessToken()
  if (!token) return null

  const user = allowRefresh ? await getCurrentUser() : await getCurrentUserWithAccessToken(token)
  const privateKey = await loadActivePrivateKey(user.id)

  if (!privateKey) return null

  cachedUnlockedSession = { user, privateKey }
  return cachedUnlockedSession
}
