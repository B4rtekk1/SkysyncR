import { useSearchParams } from 'react-router-dom'
import '../App.css'
import '../css/Login.css'
import VerifyNav from './verify/VerifyNav'
import VerifyStatusCard from './verify/VerifyStatusCard'
import { useEmailVerification } from './verify/useEmailVerification'

function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const { status, error } = useEmailVerification(token)

  return (
      <div className="auth-page">
        <VerifyNav />

        <main className="auth auth--verify">
          <section className="auth__form-wrap auth__form-wrap--centered">
            <VerifyStatusCard status={status} error={error} />
          </section>
        </main>
      </div>
  )
}

export default VerifyEmail
