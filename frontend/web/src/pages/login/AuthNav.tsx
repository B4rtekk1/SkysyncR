import { Link } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'

function AuthNav() {
  return (
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
  )
}

export default AuthNav
