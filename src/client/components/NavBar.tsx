// Componente compartido NavBar.
//
// Barra de navegación común a las páginas principales que permite moverse entre
// el CRM (Clientes), el Asistente y el Publicador (Publicaciones), además de
// cerrar la sesión. Centraliza los enlaces de navegación entre productos para
// evitar duplicar etiquetas y rutas en cada página.
//
// Todas las etiquetas se consumen del catálogo central `es.app.nav`, de modo
// que la interfaz se presenta de forma coherente y completamente en español.

import { Link } from 'react-router-dom'
import { logout } from 'wasp/client/auth'
import { es } from '../i18n/es'

/** Identifica el enlace que corresponde a la página actual (opcional). */
export type NavKey = 'clients' | 'assistant' | 'publications'

type NavBarProps = {
  /** Marca el enlace activo de la página actual para resaltarlo. */
  active?: NavKey
}

const styles = {
  nav: { display: 'flex', gap: '1rem', alignItems: 'center' } as const,
  link: { textDecoration: 'none', color: 'inherit' } as const,
  activeLink: {
    textDecoration: 'none',
    color: 'inherit',
    fontWeight: 700,
  } as const,
}

/**
 * Barra de navegación compartida en español. Renderiza los enlaces de
 * navegación entre productos y un botón para cerrar la sesión.
 */
export function NavBar({ active }: NavBarProps) {
  return (
    <nav style={styles.nav} aria-label={es.app.title}>
      <Link
        to="/"
        style={active === 'clients' ? styles.activeLink : styles.link}
        aria-current={active === 'clients' ? 'page' : undefined}
      >
        {es.app.nav.clients}
      </Link>
      <Link
        to="/chat"
        style={active === 'assistant' ? styles.activeLink : styles.link}
        aria-current={active === 'assistant' ? 'page' : undefined}
      >
        {es.app.nav.assistant}
      </Link>
      <Link
        to="/publicaciones"
        style={active === 'publications' ? styles.activeLink : styles.link}
        aria-current={active === 'publications' ? 'page' : undefined}
      >
        {es.app.nav.publications}
      </Link>
      <button type="button" onClick={() => logout()}>
        {es.app.nav.logout}
      </button>
    </nav>
  )
}

export default NavBar
