import { type SubmitEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCurrentUser, loginUser } from '../../api/users.ts'
import { decryptPrivateKey } from '../../crypto/keys'
import { loadEncryptedPrivateKey, storeActivePrivateKey } from '../../crypto/storage'
import EyeIcon from './EyeIcon'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
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
        setError('Private key is not available on this device.')
        return
      }

      const privateKey = await decryptPrivateKey(encryptedPrivateKey, password)
      await storeActivePrivateKey(user.id, privateKey)

      window.location.href = '/dashboard'
    } catch (err) {
      setError(
          err instanceof Error
              ? err.message
              : 'Something went wrong. Please try again.',
      )
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
                onChange={(e) => setEmail(e.target.value)}
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
                  onChange={(e) => setPassword(e.target.value)}
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
              <p className="auth-form__error" role="alert">
                {error}
              </p>
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
