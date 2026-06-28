import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import './Login.css'
import VaultPanel from '../components/VaultPanel'
import { generateKeyPair, exportPublicKey, encryptPrivateKey } from '../crypto/keys'
import { storeEncryptedPrivateKey } from '../crypto/storage'
import { registerUser } from '../api/users'

function suggestNameFromEmail(email: string): string {
  const local = email.includes('@') ? email.split('@')[0] : email
  return local
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
}

function Register() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'idle' | 'generating' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
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
                <input
                  className="field__input"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              <label className="field">
                <span className="field__label">Confirm password</span>
                <input
                  className="field__input"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
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
