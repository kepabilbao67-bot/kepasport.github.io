import { SignupForm } from 'wasp/client/auth'
import { Link } from 'react-router-dom'

export function SignupPage() {
  return (
    <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Crear cuenta</h1>
      <SignupForm />
      <p style={{ marginTop: '1rem' }}>
        ¿Ya tienes una cuenta? <Link to="/login">Inicia sesión</Link>.
      </p>
    </div>
  )
}
