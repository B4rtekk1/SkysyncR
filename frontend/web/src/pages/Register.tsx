import { type SubmitEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Login.css'
import VaultPanel from '../components/VaultPanel'
import ThemeToggle from '../components/ThemeToggle'
import { generateKeyPair, exportPublicKey, encryptPrivateKey } from '../crypto/keys'
import { storeEncryptedPrivateKey } from '../crypto/storage'
import { registerUser } from '../api/users'

function EyeIcon({ open }: { open: boolean }) {
  return (
      <span className={`eye-icon ${open ? 'is-open' : 'is-closed'}`}>
        <svg className="eye-icon__layer eye-icon__layer--open" viewBox="0 0 24 24" width="18" height="18">
          <path
              d="M2 12C2 12 5.5 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 18.5 18.5 12 18.5C5.5 18.5 2 12 2 12Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <svg className="eye-icon__layer eye-icon__layer--closed" viewBox="0 0 24 24" width="18" height="18">
          <path
              d="M3 3L21 21"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
          />
          <path
              d="M10.6 5.7C11.05 5.57 11.51 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 21.1 13.65 19.4 15.25M6.5 6.9C4 8.6 2 12 2 12C2 12 5.5 18.5 12 18.5C13.6 18.5 15 18.1 16.2 17.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
          />
          <path
              d="M9.9 10C9.5 10.5 9.3 11.2 9.4 11.9C9.6 13.1 10.6 14 11.8 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
          />
        </svg>
      </span>
  )
}

function suggestNameFromEmail(email: string): string {
  const local = email.includes('@') ? email.split('@')[0] : email
  return local
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
}

type Requirement = {
  label: string
  met: boolean
}

const COMMON_PASSWORDS = new Set([
  'password', 'password123', '12345678', '123456789', 'qwerty123',
  'letmein', 'welcome123', 'admin123', 'iloveyou', 'monkey123',
  'dragon123', 'football', 'baseball', 'trustno1', 'sunshine',
  'princess', 'qwertyuiop', 'password1', 'abc123456', '1q2w3e4r',
])

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
  return /(.)\1{2,}/.test(password) // same char 3+ times in a row
}

function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase())
}

function getPasswordRequirements(password: string): Requirement[] {
  return [
    { label: 'At least 12 characters', met: password.length >= 12 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /\d/.test(password) },
    { label: 'One special character (!@#$%...)', met: /[^A-Za-z0-9]/.test(password) },
    { label: 'No 3+ repeated characters (e.g. "aaa")', met: !hasRepeatedChars(password) },
    { label: 'No sequential patterns (e.g. "abcd", "1234")', met: !hasSequentialChars(password) },
    { label: 'Not a commonly used password', met: password.length === 0 || !isCommonPassword(password) },
  ]
}

// Weighted strength score, not just a count of met requirements
function getPasswordScore(password: string): number {
  if (password.length === 0) return 0

  let score = 0

  // Length carries the most weight
  if (password.length >= 12) score += 2
  if (password.length >= 16) score += 1
  if (password.length >= 20) score += 1

  // Character variety
  if (/[A-Z]/.test(password)) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  // Bonus for multiple special chars / numbers, not just one
  if ((password.match(/[^A-Za-z0-9]/g) || []).length >= 2) score += 1
  if ((password.match(/\d/g) || []).length >= 2) score += 1

  // Penalties
  if (hasRepeatedChars(password)) score -= 2
  if (hasSequentialChars(password)) score -= 2
  if (isCommonPassword(password)) score = 0

  return Math.max(0, score)
}

function getStrengthLevel(score: number): { label: string; className: string; segments: number } {
  if (score <= 2) return { label: 'Very weak', className: 'very-weak', segments: 1 }
  if (score <= 4) return { label: 'Weak', className: 'weak', segments: 2 }
  if (score <= 6) return { label: 'Fair', className: 'fair', segments: 3 }
  if (score <= 8) return { label: 'Strong', className: 'strong', segments: 4 }
  return { label: 'Very strong', className: 'very-strong', segments: 5 }
}

function PasswordRequirements({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password)
  const score = getPasswordScore(password)
  const strength = getStrengthLevel(score)

  return (
      <div className="password-requirements">
        <div className="password-requirements__header">
          <div className="password-requirements__bar">
            {[0, 1, 2, 3, 4].map((i) => (
                <span
                    key={i}
                    className={`password-requirements__segment ${
                        i < strength.segments ? `is-filled is-${strength.className}` : ''
                    }`}
                />
            ))}
          </div>
          <span className={`password-requirements__strength-label is-${strength.className}`}>
            {strength.label}
          </span>
        </div>

        <ul className="password-requirements__list">
          {requirements.map((req) => (
              <li
                  key={req.label}
                  className={`password-requirements__item ${req.met ? 'is-met' : ''}`}
              >
              <span className="password-requirements__icon" aria-hidden="true">
                {req.met ? (
                    <svg viewBox="0 0 16 16" width="10" height="10">
                      <path
                          d="M3 8.5L6.2 11.5L13 4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                      />
                    </svg>
                ) : (
                    <svg viewBox="0 0 16 16" width="10" height="10">
                      <path
                          d="M4 4L12 12M12 4L4 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                      />
                    </svg>
                )}
              </span>
                {req.label}
              </li>
          ))}
        </ul>
      </div>
  )
}

function Register() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'idle' | 'generating' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [passwordFocused, setPasswordFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const passwordRequirements = getPasswordRequirements(password)
  const allRequirementsMet = passwordRequirements.every((r) => r.met)

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!allRequirementsMet) {
      setError('Password does not meet all security requirements');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      // 1. Generate RSA key pair locally
      setStep('generating');

      const keyPair = await generateKeyPair();
      const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
      const encryptedPrivateKey = await encryptPrivateKey(
          keyPair.privateKey,
          password
      );

      // fallback name logic
      const displayName =
          name.trim() || suggestNameFromEmail(email);

      // 2. Register user (server only gets public key + auth data)
      setStep('sending');

      const { id: userId } = await registerUser({
        email,
        display_name: displayName,
        password,
        public_key: publicKeyBase64,
      });

      // 3. Store encrypted private key locally
      await storeEncryptedPrivateKey(userId, encryptedPrivateKey);

      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
      setStep('idle');
    }
  }

  const submitLabel =
      step === 'generating'
          ? 'Generating your keys…'
          : step === 'sending'
              ? 'Creating account…'
              : 'Create account'

  return (
      <div className="auth-page">
        <nav className="auth-nav">
          <Link to="/" className="auth-nav__logo">
            <span className="auth-nav__logo-mark" aria-hidden="true" />
            SkysyncR
          </Link>
          <div className="auth-nav__actions">
            <ThemeToggle className="nav__theme-toggle" />
            <Link to="/" className="auth-nav__back">
              ← Back to home
            </Link>
          </div>
        </nav>

        <main className="auth">
          <section className="auth__visual">
            <VaultPanel />
          </section>

          <section className="auth__form-wrap">
            <div className="auth__form-card">
              <p className="eyebrow">
                <span className="eyebrow__dot" /> your keys, your device
              </p>
              <h1 className="auth__title">Create your account</h1>
              <p className="auth__subtitle">
                We'll generate an encryption key pair right here in your
                browser. The private half never leaves this device.
              </p>

              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                <label className="field">
                  <span className="field__label">Email address</span>
                  <input
                      className="field__input"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                  />
                </label>

                <label className="field">
                  <span className="field__label">Name</span>
                  <input
                      className="field__input"
                      type="text"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={email.length > 0 ? suggestNameFromEmail(email) : "John Doe"}
                  />
                </label>

                <label className="field">
                  <span className="field__label">Password</span>
                  <div className="field__input-group">
                    <input
                        className="field__input"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={12}
                        value={password}
                        onFocus={() => setPasswordFocused(true)}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                    />
                    <button
                        type="button"
                        className="field__toggle-visibility"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </label>

                {(passwordFocused || password.length > 0) && (
                    <PasswordRequirements password={password} />
                )}

                <label className="field">
                  <span className="field__label">Confirm password</span>
                  <div className="field__input-group">
                    <input
                        className="field__input"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={12}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••••••"
                    />
                    <button
                        type="button"
                        className="field__toggle-visibility"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                    >
                      <EyeIcon open={showConfirmPassword} />
                    </button>
                  </div>
                </label>

                {error && (
                    <p className="auth-form__error" role="alert">
                      {error}
                    </p>
                )}

                <button
                    type="submit"
                    className="btn btn--solid btn--lg auth-form__submit"
                    disabled={loading}
                >
                  {submitLabel}
                </button>
              </form>

              <p className="auth__switch">
                Already have an account? <Link to="/login">Sign in</Link>
              </p>
            </div>
          </section>
        </main>
      </div>
  )
}

export default Register
