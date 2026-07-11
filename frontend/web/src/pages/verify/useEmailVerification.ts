import { useEffect, useState } from 'react'
import { verifyUser } from '../../api/users'
import type { VerificationStatus } from './types'

export function useEmailVerification(token: string | null) {
  const [status, setStatus] = useState<VerificationStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    async function verify(verificationToken: string) {
      setStatus('verifying')

      try {
        await verifyUser(verificationToken)
        setStatus('success')
      } catch (err) {
        setError(
            err instanceof Error
                ? err.message
                : 'Something went wrong. Please try again.',
        )
        setStatus('error')
      }
    }

    void verify(token)
  }, [token])

  return { status, error }
}
