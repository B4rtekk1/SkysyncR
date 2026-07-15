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

export async function getUnlockedVaultSession(
  options: GetUnlockedVaultSessionOptions = {},
): Promise<UnlockedVaultSession | null> {
  const allowRefresh = options.allowRefresh ?? true
  const token = allowRefresh ? await getValidAccessToken() : getAccessToken()
  if (!token) return null

  const user = allowRefresh ? await getCurrentUser() : await getCurrentUserWithAccessToken(token)
  const privateKey = await loadActivePrivateKey(user.id)

  if (!privateKey) return null

  return { user, privateKey }
}
