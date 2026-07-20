import { useEffect, useState } from 'react'
import { verifyUser } from '../../api/users'
import { clearPendingVerificationEmail } from '../../api/verificationReminder'
import type { VerificationStatus } from './types'

const verificationRequests = new Map<string, Promise<void>>()

function verifyTokenOnce(token: string): Promise<void> {
  const existing = verificationRequests.get(token)
  if (existing) return existing

  const request = verifyUser(token)
  verificationRequests.set(token, request)
  return request
}

export function useEmailVerification(token: string | null) {
  const [status, setStatus] = useState<VerificationStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let active = true

    async function verify(verificationToken: string) {
      setStatus('verifying')
      setError(null)

      try {
        await verifyTokenOnce(verificationToken)
        if (!active) return
        clearPendingVerificationEmail()
        setStatus('success')
      } catch (err) {
        if (!active) return
        setError(
            err instanceof Error
                ? err.message
                : 'Something went wrong. Please try again.',
        )
        setStatus('error')
      }
    }

    void verify(token)

    return () => {
      active = false
    }
  }, [token])

  if (!token) {
    return { status: 'error' as VerificationStatus, error: 'Missing verification token.' }
  }

  return { status, error }
}
