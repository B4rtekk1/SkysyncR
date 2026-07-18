import { type SubmitEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../App.css'
import '../css/Login.css'
import VaultPanel from '../components/VaultPanel'
import AuthNav from './login/AuthNav'
import { getRecoveryBlob, resetPassword } from '../api/users'
import { decryptPrivateKey, encryptPrivateKey, type EncryptedPrivateKey } from '../crypto/keys'
import { storeEncryptedPrivateKey } from '../crypto/storage'
import PasswordRequirements from './register/PasswordRequirements'
import { getPasswordRequirements } from './register/passwordRules'

function tokenFromLocation(): string {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)
  return hashParams.get('token') ?? queryParams.get('token') ?? ''
}

function ResetPassword() {
  const navigate = useNavigate()
  const token = useMemo(() => tokenFromLocation(), [])
  const [userId, setUserId] = useState('')
  const [recoveryBlob, setRecoveryBlob] = useState<EncryptedPrivateKey | null>(null)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loadingBlob, setLoadingBlob] = useState(() => Boolean(token))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(() => (token ? null : 'Reset token is missing.'))

  useEffect(() => {
    let active = true

    if (!token) {
      return
    }

    getRecoveryBlob(token)
      .then((response) => {
        if (!active) return
        setUserId(response.user_id)
        setRecoveryBlob(JSON.parse(response.encrypted_private_key_recovery) as EncryptedPrivateKey)
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Reset link is invalid or expired.')
      })
      .finally(() => {
        if (active) setLoadingBlob(false)
      })

    return () => {
      active = false
    }
  }, [token])

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!recoveryBlob || !userId) {
      setError('Recovery data is not available.')
      return
    }
    if (!recoveryKey || !newPassword || !confirmPassword) {
      setError('Fill in all fields.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    if (getPasswordRequirements(newPassword).some((requirement) => !requirement.met)) {
      setError('New password does not meet the password policy.')
      return
    }

    setSaving(true)
    try {
      const privateKey = await decryptPrivateKey(recoveryBlob, recoveryKey, true)
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, newPassword)
      await storeEncryptedPrivateKey(userId, encryptedPrivateKey)
      await resetPassword({ token, new_password: newPassword })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password.')
    } finally {
      setSaving(false)
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
                <span className="eyebrow__dot" /> local key recovery
              </p>
              <h1 className="auth__title">Set a new password</h1>
              <p className="auth__subtitle">
                Use your recovery key to unlock the private key locally, then choose a new password.
              </p>
              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                <label className="field">
                  <span className="field__label">Recovery key</span>
                  <input
                      className="field__input"
                      type="text"
                      autoComplete="off"
                      required
                      value={recoveryKey}
                      onChange={(e) => setRecoveryKey(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">New password</span>
                  <input
                      className="field__input"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                {newPassword.length > 0 && <PasswordRequirements password={newPassword} />}
                <label className="field">
                  <span className="field__label">Confirm new password</span>
                  <input
                      className="field__input"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
                {error && <p className="auth-form__error" role="alert">{error}</p>}
                <button
                    type="submit"
                    className="btn btn--solid btn--lg auth-form__submit"
                    disabled={loadingBlob || saving || !recoveryBlob}
                >
                  {loadingBlob ? 'Loading...' : saving ? 'Resetting...' : 'Reset password'}
                </button>
              </form>
              <p className="auth__switch">
                Back to <Link to="/login">sign in</Link>
              </p>
            </div>
          </section>
        </main>
      </div>
  )
}

export default ResetPassword
