import {lazy, Suspense, useEffect} from 'react'
import {Routes, Route, useNavigate} from './router'
import {
    loadDashboardPage,
    loadForgotPasswordPage,
    loadLandingPage,
    loadLoginPage,
    loadNotFoundPage,
    loadPublicSharePage,
    loadRegisterPage,
    loadResetPasswordPage,
    loadVerifyEmailPage,
} from './routePreloads'

const Landing = lazy(loadLandingPage)
const Login = lazy(loadLoginPage)
const Register = lazy(loadRegisterPage)
const ForgotPassword = lazy(loadForgotPasswordPage)
const ResetPassword = lazy(loadResetPasswordPage)
const VerifyEmail = lazy(loadVerifyEmailPage)
const Dashboard = lazy(loadDashboardPage)
const NotFound = lazy(loadNotFoundPage)
const PublicShare = lazy(loadPublicSharePage)

function RouteFallback() {
    return (
        <div className="route-loading" role="status" aria-live="polite">
            <span className="route-loading__spinner" />
            <span>Loading...</span>
        </div>
    )
}

function LandingRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        let active = true

        import('./api/session')
            .then(({ getUnlockedVaultSession }) => getUnlockedVaultSession({ allowRefresh: false }))
            .then((session) => {
                if (active && session) {
                    navigate('/dashboard', {replace: true})
                }
            })
            .catch(() => {
                // Stay on the landing page when the saved session cannot be restored.
            })

        return () => {
            active = false
        }
    }, [navigate])

    return <Landing/>
}

function App() {
    return (
        <Suspense fallback={<RouteFallback/>}>
            <Routes>
                <Route path="/" element={<LandingRoute/>}/>
                <Route path="/login" element={<Login/>}/>
                <Route path="/register" element={<Register/>}/>
                <Route path="/forgot-password" element={<ForgotPassword/>}/>
                <Route path="/reset-password" element={<ResetPassword/>}/>
                <Route path="/verify" element={<VerifyEmail/>}/>
                <Route path="/share/:token" element={<PublicShare/>}/>
                <Route path="/share/folders/:token" element={<PublicShare/>}/>
                <Route path="/dashboard" element={<Dashboard/>}/>
                <Route path="*" element={<NotFound/>}/>
            </Routes>
        </Suspense>
    )
}

export default App
