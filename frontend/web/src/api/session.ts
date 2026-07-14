import { getValidAccessToken } from './auth'
import { getCurrentUser, type CurrentUserResponse } from './users'
import { loadActivePrivateKey } from '../crypto/storage'

export type UnlockedVaultSession = {
  user: CurrentUserResponse
  privateKey: CryptoKey
}

export async function getUnlockedVaultSession(): Promise<UnlockedVaultSession | null> {
  const token = await getValidAccessToken()
  if (!token) return null

  const user = await getCurrentUser()
  const privateKey = await loadActivePrivateKey(user.id)

  if (!privateKey) return null

  return { user, privateKey }
}
