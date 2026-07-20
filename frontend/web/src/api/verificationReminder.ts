const PENDING_VERIFICATION_EMAIL_KEY = 'skysyncr.pendingVerificationEmail'

export function loadPendingVerificationEmail() {
  try {
    return sessionStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY)
  } catch {
    return null
  }
}

export function savePendingVerificationEmail(email: string) {
  try {
    sessionStorage.setItem(PENDING_VERIFICATION_EMAIL_KEY, email)
  } catch {
    // The current screen can still show the email when session storage is unavailable.
  }
}

export function clearPendingVerificationEmail() {
  try {
    sessionStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY)
  } catch {
    // Ignore storage failures; the account state is controlled by the server.
  }
}
