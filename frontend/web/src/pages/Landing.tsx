import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import '../App.css'
import TransferLog from '../components/TransferLog'
import ThemeToggle from '../components/ThemeToggle'
import { resendVerificationEmail } from '../api/users'
import { loadPendingVerificationEmail, savePendingVerificationEmail } from '../api/verificationReminder'

interface LandingLocationState {
  verificationPromptEmail?: string
}

function Landing() {
  const location = useLocation()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  const [navSolid, setNavSolid] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const featuresRef = useRef<HTMLDivElement>(null)
  const [featuresVisible, setFeaturesVisible] = useState(false)
  const [verificationPromptEmail] = useState<string | null>(() => {
    const state = location.state as LandingLocationState | null
    return state?.verificationPromptEmail ?? loadPendingVerificationEmail()
  })

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 40)
    const onScroll = () => setNavSolid(window.scrollY > 8)
    window.addEventListener('scroll', onScroll)
    return () => {
      clearTimeout(t)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  async function resendVerification() {
    if (!verificationPromptEmail || resendStatus === 'sending') return

    setResendStatus('sending')
    try {
      await resendVerificationEmail(verificationPromptEmail)
      setResendStatus('sent')
    } catch {
      setResendStatus('error')
    }
  }

  useEffect(() => {
    const state = location.state as LandingLocationState | null
    if (!state?.verificationPromptEmail) return

    savePendingVerificationEmail(state.verificationPromptEmail)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    const node = featuresRef.current
    if (!node) return
    const obs = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return
          if (entry.isIntersecting) setFeaturesVisible(true)
        },
        { threshold: 0.2 },
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [])

  return (
      <div className="page">
        <nav className={`nav ${navSolid ? 'nav--solid' : ''}`}>
          <div className="nav__inner">
            <Link to="/" className="nav__logo">
              <span className="nav__logo-mark" aria-hidden="true" />
              SkysyncR
            </Link>
            <div className="nav__actions">
              <ThemeToggle className="nav__theme-toggle" />
              <Link to="/login" className="btn btn--ghost">Sign in</Link>
              <Link to="/register" className="btn btn--solid">Create account</Link>
            </div>
          </div>
        </nav>

        <main id="top" className="hero">
          <div className={`hero__copy ${loaded ? 'is-in' : ''}`}>
            <p className="eyebrow">
              <span className="eyebrow__dot" /> end-to-end encrypted
            </p>
            <h1 className="h1">
              <span className="h1__line">Your files are locked</span>
              <span className="h1__line">before they leave your device.</span>
            </h1>
            <p className="lede">
              SkysyncR encrypts every file locally with AES-256 before it
              goes anywhere else. We never see the contents — only that
              it's safe.
            </p>
            <div className="cta-row">
              <Link to="/register" className="btn btn--solid btn--lg">
                Create a free account
              </Link>
              <Link to="/login" className="btn btn--outline btn--lg">Sign in</Link>
            </div>
            <p className="trust-line">
              No card required · your private key stays with you
            </p>
          </div>

          <div className={`hero__signature ${loaded ? 'is-in' : ''}`}>
            <TransferLog />
          </div>
        </main>

        <section className="features" ref={featuresRef}>
          <div className={`features__grid ${featuresVisible ? 'is-in' : ''}`}>
            <article className="feature">
              <p className="feature__index">Encrypted</p>
              <h3 className="feature__title">Before anything leaves</h3>
              <p className="feature__body">
                Every file gets its own AES-256-GCM key, generated on your
                device. The plain file never travels in the open.
              </p>
            </article>
            <article className="feature">
              <p className="feature__index">Synced</p>
              <h3 className="feature__title">Up to date on every device</h3>
              <p className="feature__body">
                A change on your laptop shows up on your phone within
                seconds — still encrypted until the very last step.
              </p>
            </article>
            <article className="feature">
              <p className="feature__index">Yours</p>
              <h3 className="feature__title">Private key, private data</h3>
              <p className="feature__body">
                The decryption key stays on your side. We don't store it —
                so we can't hand it to anyone, either.
              </p>
            </article>
          </div>
        </section>

        <footer className="footer">
          <span>© {new Date().getFullYear()} SkysyncR</span>
          <span className="footer__sep">·</span>
          <span>Encrypted locally, always.</span>
        </footer>

        {verificationPromptEmail && (
            <div className="register-popup" role="presentation">
              <div
                  className="register-popup__dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="register-popup-title"
                  aria-describedby="register-popup-description"
              >
                <h2 id="register-popup-title">Verify your account</h2>
                <p id="register-popup-description">
                  We sent a verification link to {verificationPromptEmail}. Open it before signing in.
                </p>
                <button
                    type="button"
                    className="btn btn--solid btn--lg register-popup__action"
                    onClick={() => void resendVerification()}
                    disabled={resendStatus === 'sending'}
                >
                  {resendStatus === 'sending' ? 'Sending...' : 'Send email again'}
                </button>
                <button
                    type="button"
                    className="btn btn--outline btn--lg register-popup__action"
                    onClick={() => navigate('/login')}
                >
                  Continue to sign in
                </button>
                {resendStatus === 'sent' && <p className="register-popup__status">A new verification link has been sent.</p>}
                {resendStatus === 'error' && <p className="register-popup__status register-popup__status--error">Could not send the email. Try again.</p>}
              </div>
            </div>
        )}
      </div>
  )
}

export default Landing
