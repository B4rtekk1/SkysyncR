import { type SubmitEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Login.css'
import {loginUser} from '../api/users.ts'
import VaultPanel from '../components/VaultPanel'
import ThemeToggle from '../components/ThemeToggle'

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

function Login() {
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
                <span className="eyebrow__dot" /> unlock your vault
              </p>
              <h1 className="auth__title">Sign in</h1>
              <p className="auth__subtitle">
                Your data is still waiting, encrypted — unlock it with your
                account.
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
          </section>
        </main>
      </div>
  )
}

export default Login
