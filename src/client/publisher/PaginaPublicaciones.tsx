import { Link } from 'react-router-dom'
import { getVideoPosts, useQuery } from 'wasp/client/operations'
import { es } from '../i18n/es'

/**
 * PaginaPublicaciones (Tarea 9.3).
 *
 * Listado de las Publicacion_Video del Agente autenticado. Consume la consulta
 * de Wasp `getVideoPosts`, que ya devuelve las publicaciones del propietario
 * ordenadas por `createdAt` descendente (Requisitos 4.1, 1.4), por lo que la
 * interfaz preserva ese orden sin reordenar en cliente.
 *
 * Cada elemento enlaza al detalle (`/publicaciones/:id`) y muestra la URL del
 * vídeo (o la referencia de archivo, como respaldo) junto con un resumen breve
 * del brief. Se ofrece además un enlace destacado para crear una nueva
 * publicación (`/publicaciones/nueva`).
 *
 * Los estados de carga, vacío y error se muestran completamente en español a
 * partir del catálogo central `es` (Requisitos 9.1, 9.2).
 */

/** Forma mínima de una Publicacion_Video que consume el listado. */
type VideoPostRow = {
  id: number
  videoUrl: string
  fileRef?: string | null
  brief?: string | null
  createdAt?: string | Date | null
}

const styles = {
  page: { maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' } as const,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  } as const,
  nav: { display: 'flex', gap: '1rem', alignItems: 'center' } as const,
  newButton: {
    textDecoration: 'none',
    color: '#fff',
    background: '#2563eb',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
  } as const,
  list: { listStyle: 'none', padding: 0, margin: '1.5rem 0 0' } as const,
  item: { padding: '0.75rem 0', borderBottom: '1px solid #e2e2e2' } as const,
  itemLink: {
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
  } as const,
  itemTitle: { fontWeight: 600, wordBreak: 'break-all' } as const,
  itemMeta: { color: '#666', fontSize: '0.9rem', marginTop: '0.25rem' } as const,
  itemSummary: { color: '#444', marginTop: '0.25rem' } as const,
  state: { color: '#666', margin: '1rem 0' } as const,
}

/** Acorta el brief para mostrar un resumen breve en el listado. */
function buildSummary(brief: VideoPostRow['brief']): string {
  const text = (brief ?? '').trim()
  if (!text) return ''
  const max = 120
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

/** Da formato legible (en español) a la fecha de creación. */
function formatCreatedAt(value: VideoPostRow['createdAt']): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-ES')
}

export function PaginaPublicaciones() {
  const { data, isLoading, error } = useQuery(getVideoPosts)
  const posts = (data ?? []) as VideoPostRow[]

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1>{es.publisher.pageTitle}</h1>
        <nav style={styles.nav}>
          <Link to="/clientes">{es.app.nav.clients}</Link>
          <Link to="/chat">{es.app.nav.assistant}</Link>
          <Link to="/publicaciones/nueva" style={styles.newButton}>
            {es.publisher.newPost}
          </Link>
        </nav>
      </header>

      {isLoading && <p style={styles.state}>{es.publisher.loading}</p>}

      {!isLoading && error && (
        <p style={styles.state} role="alert">
          {es.errors.generic}
        </p>
      )}

      {!isLoading && !error && posts.length === 0 && (
        <p style={styles.state}>{es.publisher.empty}</p>
      )}

      {!isLoading && !error && posts.length > 0 && (
        <ul style={styles.list}>
          {posts.map((post) => {
            const summary = buildSummary(post.brief)
            const createdAt = formatCreatedAt(post.createdAt)
            const primary = post.videoUrl || post.fileRef || ''
            return (
              <li key={post.id} style={styles.item}>
                <Link to={`/publicaciones/${post.id}`} style={styles.itemLink}>
                  <div style={styles.itemTitle}>
                    {primary || `#${post.id}`}
                  </div>
                  {summary && <div style={styles.itemSummary}>{summary}</div>}
                  {createdAt && <div style={styles.itemMeta}>{createdAt}</div>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default PaginaPublicaciones
