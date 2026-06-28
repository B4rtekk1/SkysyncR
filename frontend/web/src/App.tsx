import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import RegisterPlaceholder from './pages/RegisterPlaceholder'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<RegisterPlaceholder />} />
    </Routes>
  )
}

export default App
