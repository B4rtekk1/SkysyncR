import { Link } from 'react-router-dom'
import type { VerificationStatus } from './types'

function VerifyStatusCard({ status, error }: { status: VerificationStatus; error: string | null }) {
  return (
      <div className="auth__form-card verify-card">
        {status === 'verifying' && (
            <>
              <h1 className="auth__title">Verifying your email…</h1>
              <p className="auth__subtitle">Just a moment.</p>
            </>
        )}

        {status === 'success' && (
            <>
              <h1 className="auth__title">Email verified</h1>
              <p className="auth__subtitle">
                Your email has been successfully verified.
              </p>

              <Link to="/login" className="btn btn--solid btn--lg verify-card__action">
                Sign in
              </Link>
            </>
        )}

        {status === 'error' && (
            <>
              <h1 className="auth__title">Verification failed</h1>
              <p className="auth__subtitle">{error}</p>

              <Link to="/login" className="btn btn--outline btn--lg verify-card__action">
                Back to sign in
              </Link>
            </>
        )}
      </div>
  )
}

export default VerifyStatusCard
