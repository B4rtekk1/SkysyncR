import { Link } from '../../router'
import ThemeToggle from '../../components/ThemeToggle'

function AuthNav() {
  return (
      <nav className="auth-nav">
        <Link
          to="/"
          className="auth-nav__logo"
          onClick={(event) => {
            event.preventDefault()
            window.location.reload()
          }}
        >
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
