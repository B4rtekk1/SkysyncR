import { type SubmitEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerUser } from '../../api/users'
import { generateKeyPair, exportPublicKey, encryptPrivateKey, decryptPrivateKey, generateRecoveryKey } from '../../crypto/keys'
import { storeActivePrivateKey, storeEncryptedPrivateKey } from '../../crypto/storage'
import EyeIcon from '../login/EyeIcon'
import PasswordRequirements from './PasswordRequirements'
import { getPasswordRequirements, suggestNameFromEmail } from './passwordRules'

type RegisterField = 'email' | 'password' | 'confirmPassword'

type RegisterError = {
  title: string
  message: string
  field?: RegisterField
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function RegisterForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'idle' | 'generating' | 'sending'>('idle')
  const [error, setError] = useState<RegisterError | null>(null)
  const [passwordFocused, setPasswordFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState('')

  function clearErrorFor(field: RegisterField) {
    setError((current) => {
      if (!current) return null
      return !current.field || current.field === field ? null : current
    })
  }

  function validateForm(): RegisterError | null {
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      return {
        title: 'Email is required',
        message: 'Enter the email address you want to use for this account.',
        field: 'email',
      }
    }

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return {
        title: 'Check the email address',
        message: 'Use a full email address, for example you@example.com.',
        field: 'email',
      }
    }

    if (!password) {
      return {
        title: 'Password is required',
        message: 'Create a password before generating your encryption keys.',
        field: 'password',
      }
    }

    const unmetPasswordRequirement = getPasswordRequirements(password).find((requirement) => !requirement.met)
    if (unmetPasswordRequirement) {
      return {
        title: 'Password is not strong enough',
        message: unmetPasswordRequirement.label,
        field: 'password',
      }
    }

    if (!confirmPassword) {
      return {
        title: 'Confirm your password',
        message: 'Re-enter the same password to continue.',
        field: 'confirmPassword',
      }
    }

    if (password !== confirmPassword) {
      return {
        title: 'Passwords do not match',
        message: 'Both password fields must contain the same value.',
        field: 'confirmPassword',
      }
    }

    return null
  }

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      if (validationError.field === 'password') setPasswordFocused(true)
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    setLoading(true)

    try {
      setStep('generating')

      const keyPair = await generateKeyPair()
      const publicKeyBase64 = await exportPublicKey(keyPair.publicKey)
      const nextRecoveryKey = generateRecoveryKey()
      const encryptedPrivateKey = await encryptPrivateKey(
          keyPair.privateKey,
          password,
      )
      const encryptedPrivateKeyRecovery = await encryptPrivateKey(
          keyPair.privateKey,
          nextRecoveryKey,
      )

      const displayName = name.trim() || suggestNameFromEmail(email)

      setStep('sending')

      const { id: userId } = await registerUser({
        email: normalizedEmail,
        display_name: displayName,
        password,
        public_key: publicKeyBase64,
        encrypted_private_key_recovery: JSON.stringify(encryptedPrivateKeyRecovery),
      })

      await storeEncryptedPrivateKey(userId, encryptedPrivateKey)
      const activePrivateKey = await decryptPrivateKey(encryptedPrivateKey, password)
      await storeActivePrivateKey(userId, activePrivateKey)

      setRecoveryKey(nextRecoveryKey)
      setVerificationEmail(normalizedEmail)
    } catch (err) {
      setError({
        title: 'Could not create account',
        message: err instanceof Error ? err.message : 'Something went wrong.',
      })
    } finally {
      setLoading(false)
      setStep('idle')
    }
  }

  const submitLabel =
      step === 'generating'
          ? 'Generating your keys…'
          : step === 'sending'
              ? 'Creating account…'
              : 'Create account'

  if (recoveryKey) {
    return (
        <div className="auth__form-card">
          <p className="eyebrow">
            <span className="eyebrow__dot" /> recovery key
          </p>
          <h1 className="auth__title">Save your recovery key</h1>
          <p className="auth__subtitle">
            You need this key to reset your password without losing access to encrypted files.
          </p>
          <div className="auth-form__error" role="status">
            <strong>{recoveryKey}</strong>
            <span>Store it somewhere private. SkysyncR cannot show it again.</span>
          </div>
          <button
              type="button"
              className="btn btn--solid btn--lg auth-form__submit"
              onClick={() => navigate('/', {
                state: {
                  verificationPromptEmail: verificationEmail,
                },
              })}
          >
            I saved it
          </button>
        </div>
    )
  }

  return (
      <div className="auth__form-card">
        <p className="eyebrow">
          <span className="eyebrow__dot" /> your keys, your device
        </p>
        <h1 className="auth__title">Create your account</h1>
        <p className="auth__subtitle">
          We'll generate an encryption key pair right here in your browser.
          The private half never leaves this device.
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
                aria-invalid={error?.field === 'email'}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearErrorFor('email')
                }}
                placeholder="you@example.com"
            />
          </label>

          <label className="field">
            <span className="field__label">Name</span>
            <input
                className="field__input"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={email.length > 0 ? suggestNameFromEmail(email) : 'John Doe'}
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
                  value={password}
                  aria-invalid={error?.field === 'password'}
                  onFocus={() => setPasswordFocused(true)}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearErrorFor('password')
                  }}
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
                  value={confirmPassword}
                  aria-invalid={error?.field === 'confirmPassword'}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    clearErrorFor('confirmPassword')
                  }}
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
              <div className="auth-form__error" role="alert">
                <strong>{error.title}</strong>
                <span>{error.message}</span>
              </div>
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
  )
}

export default RegisterForm
