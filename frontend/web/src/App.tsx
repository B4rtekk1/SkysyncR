import {lazy, Suspense, useEffect} from 'react'
import {Routes, Route, useNavigate} from 'react-router-dom'
import {getUnlockedVaultSession} from './api/session'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyUser'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NotFound = lazy(() => import('./pages/NotFound'))
const PublicShare = lazy(() => import('./pages/PublicShare'))

function RouteFallback() {
    return null
}

function LandingRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        let active = true

        getUnlockedVaultSession({ allowRefresh: false })
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
