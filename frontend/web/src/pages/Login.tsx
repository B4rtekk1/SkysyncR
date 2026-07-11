import '../App.css'
import '../css/Login.css'
import VaultPanel from '../components/VaultPanel'
import AuthNav from './login/AuthNav'
import LoginForm from './login/LoginForm'

function Login() {
  return (
      <div className="auth-page">
        <AuthNav />

        <main className="auth">
          <section className="auth__visual">
            <VaultPanel />
          </section>

          <section className="auth__form-wrap">
            <LoginForm />
          </section>
        </main>
      </div>
  )
}

export default Login
