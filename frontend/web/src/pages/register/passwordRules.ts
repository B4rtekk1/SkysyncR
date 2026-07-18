export type Requirement = {
  label: string
  met: boolean
}

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

const COMMON_PASSWORDS = new Set([
  'password', 'password123', 'password123!', '12345678', '123456789', 'qwerty123',
  'letmein', 'welcome123', 'admin123', 'iloveyou', 'monkey123',
  'dragon123', 'football', 'baseball', 'trustno1', 'sunshine',
  'princess', 'qwertyuiop', 'password1', 'abc123456', '1q2w3e4r',
])

export function suggestNameFromEmail(email: string): string {
  const local = email.includes('@') ? (email.split('@')[0] ?? '') : email
  return local
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
}

function hasSequentialChars(password: string): boolean {
  const lower = password.toLowerCase()
  const sequences = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  for (const seq of sequences) {
    for (let i = 0; i <= seq.length - 4; i++) {
      const chunk = seq.slice(i, i + 4)
      const reversed = chunk.split('').reverse().join('')
      if (lower.includes(chunk) || lower.includes(reversed)) return true
    }
  }
  return false
}

function hasRepeatedChars(password: string): boolean {
  return /(.)\1{2,}/.test(password)
}

function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase())
}

export function getPasswordRequirements(password: string): Requirement[] {
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { label: `No more than ${PASSWORD_MAX_LENGTH} characters`, met: password.length <= PASSWORD_MAX_LENGTH },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /\d/.test(password) },
    { label: 'One special character (!@#$%...)', met: /[^A-Za-z0-9]/.test(password) },
    { label: 'No 3+ repeated characters (e.g. "aaa")', met: !hasRepeatedChars(password) },
    { label: 'No sequential patterns (e.g. "abcd", "1234")', met: !hasSequentialChars(password) },
    { label: 'Not a commonly used password', met: password.length === 0 || !isCommonPassword(password) },
  ]
}

export function getPasswordScore(password: string): number {
  if (password.length === 0) return 0

  let score = 0

  if (password.length >= PASSWORD_MIN_LENGTH) score += 2
  if (password.length >= 16) score += 1
  if (password.length >= 20) score += 1

  if (/[A-Z]/.test(password)) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  if ((password.match(/[^A-Za-z0-9]/g) || []).length >= 2) score += 1
  if ((password.match(/\d/g) || []).length >= 2) score += 1

  if (hasRepeatedChars(password)) score -= 2
  if (hasSequentialChars(password)) score -= 2
  if (isCommonPassword(password)) score = 0

  return Math.max(0, score)
}

export function getStrengthLevel(score: number): { label: string; className: string; segments: number } {
  if (score <= 2) return { label: 'Very weak', className: 'very-weak', segments: 1 }
  if (score <= 4) return { label: 'Weak', className: 'weak', segments: 2 }
  if (score <= 6) return { label: 'Fair', className: 'fair', segments: 3 }
  if (score <= 8) return { label: 'Strong', className: 'strong', segments: 4 }
  return { label: 'Very strong', className: 'very-strong', segments: 5 }
}
