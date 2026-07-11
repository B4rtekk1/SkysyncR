import '../App.css'
import '../css/Login.css'
import VaultPanel from '../components/VaultPanel'
import AuthNav from './login/AuthNav'
import RegisterForm from './register/RegisterForm'

function Register() {
  return (
      <div className="auth-page">
        <AuthNav />

        <main className="auth">
          <section className="auth__visual">
            <VaultPanel />
          </section>

          <section className="auth__form-wrap">
            <RegisterForm />
          </section>
        </main>
      </div>
  )
}

export default Register
