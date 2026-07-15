import { type SubmitEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearTokens } from '../../api/auth.ts'
import { getUnlockedVaultSession } from '../../api/session.ts'
import { ApiRequestError, getCurrentUser, loginUser } from '../../api/users.ts'
import { isNetworkError } from '../../api/http.ts'
import { decryptPrivateKey } from '../../crypto/keys'
import { loadEncryptedPrivateKey, storeActivePrivateKey } from '../../crypto/storage'
import EyeIcon from './EyeIcon'

type LoginError = {
  title: string
  message: string
  action?: string
  field?: 'email' | 'password'
}

function messageFromError(err: unknown): string {
  return err instanceof Error && err.message
      ? err.message
      : 'Something went wrong. Please try again.'
}

function LoginForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<LoginError | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let active = true

    getUnlockedVaultSession({ allowRefresh: false })
      .then((session) => {
        if (active && session) {
          navigate('/dashboard', { replace: true })
        }
      })
      .catch(() => {
        // Stay on the login form when the saved session cannot be restored.
      })

    return () => {
      active = false
    }
  }, [navigate])

  function clearErrorFor(field?: 'email' | 'password') {
    setError((current) => {
      if (!current) return null
      if (!field || !current.field || current.field === field) return null
      return current
    })
  }

  function validateForm(): LoginError | null {
    if (!email.trim()) {
      return {
        title: 'Email is required',
        message: 'Enter the email address connected to your SkysyncR account.',
        field: 'email',
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return {
        title: 'Check the email address',
        message: 'Use a full email address, for example you@example.com.',
        field: 'email',
      }
    }

    if (!password) {
      return {
        title: 'Password is required',
        message: 'Enter your password to unlock this device.',
        field: 'password',
      }
    }

    return null
  }

  function getLoginError(err: unknown): LoginError {
    if (isNetworkError(err)) {
      return {
        title: 'Cannot reach the server',
        message: 'Check your connection or make sure the API is running, then try again.',
        action: 'No login attempt was completed.',
      }
    }

    if (err instanceof ApiRequestError) {
      if (err.status === 400) {
        return {
          title: 'Check your details',
          message: err.message,
          field: err.message.toLowerCase().includes('email') ? 'email' : 'password',
        }
      }

      if (err.status === 401) {
        return {
          title: 'Invalid email or password',
          message: 'The credentials do not match an account. Check both fields and try again.',
          action: 'Failed attempts may temporarily lock this account.',
          field: 'password',
        }
      }

      if (err.status === 403) {
        return {
          title: 'Email is not verified',
          message: 'Verify this email address before signing in.',
          action: 'Open the verification link from your email inbox.',
          field: 'email',
        }
      }

      if (err.status === 429) {
        return {
          title: 'Too many attempts',
          message: 'This account is temporarily locked after several failed logins.',
          action: 'Wait a few minutes before trying again.',
        }
      }

      if (err.status >= 500) {
        return {
          title: 'Server error',
          message: 'The server could not complete the login right now.',
          action: 'Try again in a moment.',
        }
      }
    }

    return {
      title: 'Login failed',
      message: messageFromError(err),
    }
  }

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    try {
      await loginUser(
          {
            email,
            password,
          },
          remember,
      )
      const user = await getCurrentUser()
      const encryptedPrivateKey = await loadEncryptedPrivateKey(user.id)

      if (!encryptedPrivateKey) {
        clearTokens()
        setError({
          title: 'This device cannot unlock the vault',
          message: 'The encrypted private key is not stored in this browser.',
          action: 'Sign in on the device where the account was created or restore the key first.',
        })
        return
      }

      let privateKey: CryptoKey
      try {
        privateKey = await decryptPrivateKey(encryptedPrivateKey, password)
      } catch {
        clearTokens()
        setError({
          title: 'Saved key could not be unlocked',
          message: 'The local private key does not match this password or is corrupted.',
          action: 'Try signing in on the original device or recreate the local key backup.',
          field: 'password',
        })
        return
      }

      await storeActivePrivateKey(user.id, privateKey)

      window.location.href = '/dashboard'
    } catch (err) {
      setError(getLoginError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
      <div className="auth__form-card">
        <p className="eyebrow">
          <span className="eyebrow__dot" /> unlock your vault
        </p>
        <h1 className="auth__title">Sign in</h1>
        <p className="auth__subtitle">
          Your data is still waiting, encrypted — unlock it with your account.
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field__label">Email address</span>
            <input
                className="field__input"
                type="email"
                name="email"
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
            <span className="field__label-row">
              <span className="field__label">Password</span>
              <Link to="/forgot-password" className="field__hint-link">
                Forgot password?
              </Link>
            </span>
            <div className="field__input-group">
              <input
                  className="field__input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  aria-invalid={error?.field === 'password'}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearErrorFor('password')
                  }}
                  placeholder="••••••••"
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

          <label className="checkbox">
            <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember this device</span>
          </label>

          {error && (
              <div className="auth-form__error" role="alert">
                <strong>{error.title}</strong>
                <span>{error.message}</span>
                {error.action && <small>{error.action}</small>}
              </div>
          )}

          <button
              type="submit"
              className="btn btn--solid btn--lg auth-form__submit"
              disabled={loading}
          >
            {loading ? 'Unlocking…' : 'Sign in'}
          </button>
        </form>

        <p className="auth__switch">
          Don't have an account? <Link to="/register">Create one now</Link>
        </p>
      </div>
  )
}

export default LoginForm
