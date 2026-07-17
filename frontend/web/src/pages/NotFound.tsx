import { Link } from 'react-router-dom'
import '../App.css'
import ThemeToggle from '../components/ThemeToggle'

function NotFound() {
  return (
    <div className="page not-found-page">
      <nav className="nav nav--solid">
        <div className="nav__inner">
          <Link to="/" className="nav__logo">
            <span className="nav__logo-mark" aria-hidden="true" />
            SkysyncR
          </Link>
          <div className="nav__actions">
            <ThemeToggle className="nav__theme-toggle" />
            <Link to="/login" className="btn btn--ghost">Sign in</Link>
          </div>
        </div>
      </nav>

      <main className="not-found" aria-labelledby="not-found-title">
        <p className="not-found__code">404</p>
        <h1 id="not-found-title" className="not-found__title">
          Page not found
        </h1>
        <p className="not-found__copy">
          The link may be broken, moved, or no longer available.
        </p>
        <div className="not-found__actions">
          <Link to="/" className="btn btn--solid btn--lg">
            Back to home
          </Link>
          <Link to="/dashboard" className="btn btn--outline btn--lg">
            Open dashboard
          </Link>
        </div>
      </main>
    </div>
  )
}

export default NotFound
