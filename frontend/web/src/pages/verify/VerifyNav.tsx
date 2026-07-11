import { Link } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'

function VerifyNav() {
  return (
      <nav className="auth-nav">
        <Link to="/" className="auth-nav__logo">
          <span className="auth-nav__logo-mark" aria-hidden="true" />
          SkysyncR
        </Link>
        <ThemeToggle className="nav__theme-toggle" />
      </nav>
  )
}

export default VerifyNav
