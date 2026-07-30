import { Link } from '../../router'
import ThemeToggle from '../../components/ThemeToggle'

function VerifyNav() {
  return (
      <nav className="auth-nav">
        <Link to="/" className="auth-nav__logo">
          SkysyncR
        </Link>
        <ThemeToggle className="nav__theme-toggle" />
      </nav>
  )
}

export default VerifyNav
