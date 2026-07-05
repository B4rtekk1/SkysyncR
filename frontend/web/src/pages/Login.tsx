import { type SubmitEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Login.css'
import {loginUser} from '../api/users.ts'
import VaultPanel from '../components/VaultPanel'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          <Link to="/" className="auth-nav__back">
            ← Back to home
          </Link>
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
                  <input
                      className="field__input"
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                  />
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