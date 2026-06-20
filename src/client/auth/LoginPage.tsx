import { LoginForm } from 'wasp/client/auth'
import { Link } from 'react-router-dom'

export function LoginPage() {
  return (
    <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Iniciar sesión</h1>
      <LoginForm />
      <p style={{ marginTop: '1rem' }}>
        ¿No tienes una cuenta? <Link to="/signup">Regístrate</Link>.
      </p>
    </div>
  )
}
