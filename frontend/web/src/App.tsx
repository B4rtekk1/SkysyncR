import {useEffect} from 'react'
import {Routes, Route, useNavigate} from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from "./pages/VerifyUser";
import Dashboard from './pages/Dashboard'
import NotFound from './pages/NotFound'
import PublicShare from './pages/PublicShare'
import {getUnlockedVaultSession} from './api/session'

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
        <Routes>
            <Route path="/" element={<LandingRoute/>}/>
            <Route path="/login" element={<Login/>}/>
            <Route path="/register" element={<Register/>}/>
            <Route path="/forgot-password" element={<ForgotPassword/>}/>
            <Route path="/reset-password" element={<ResetPassword/>}/>
            <Route path="/verify" element={<VerifyEmail/>}/>
            <Route path="/share/:token" element={<PublicShare/>}/>
            <Route path="/dashboard" element={<Dashboard/>}/>
            <Route path="*" element={<NotFound/>}/>
        </Routes>
    )
}

export default App
