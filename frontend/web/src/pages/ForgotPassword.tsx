import { type SubmitEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import '../css/Login.css'
import VaultPanel from '../components/VaultPanel'
import AuthNav from './login/AuthNav'
import { forgotPassword } from '../api/users'

function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await forgotPassword({ email })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request password reset.')
    } finally {
      setLoading(false)
    }
  }

  return (
      <div className="auth-page">
        <AuthNav />
        <main className="auth">
          <section className="auth__visual">
            <VaultPanel />
          </section>
          <section className="auth__form-wrap">
            <div className="auth__form-card">
              <p className="eyebrow">
                <span className="eyebrow__dot" /> account recovery
              </p>
              <h1 className="auth__title">Reset password</h1>
              <p className="auth__subtitle">
                Enter your email address. If it is verified, you will receive a recovery link.
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
                {sent && (
                    <p className="auth-form__error" role="status">
                      If this verified email exists, a reset link has been sent.
                    </p>
                )}
                {error && <p className="auth-form__error" role="alert">{error}</p>}
                <button
                    type="submit"
                    className="btn btn--solid btn--lg auth-form__submit"
                    disabled={loading}
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
              <p className="auth__switch">
                Remembered it? <Link to="/login">Sign in</Link>
              </p>
            </div>
          </section>
        </main>
      </div>
  )
}

export default ForgotPassword
