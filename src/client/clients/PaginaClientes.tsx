import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getClients, searchClients, useQuery } from 'wasp/client/operations'
import { es } from '../i18n/es'
import { NavBar } from '../components/NavBar'

/**
 * PaginaClientes (Tarea 14.2).
 *
 * Listado y búsqueda de clientes del Agente autenticado. Consume las consultas
 * de Wasp `getClients` y `searchClients` (Requisitos 2.6, 3.1):
 *   - Sin término de búsqueda, muestra todos los clientes ordenados por
 *     actividad reciente (`getClients`, orden por `lastActivityAt desc`).
 *   - Con término, delega en `searchClients`, que filtra de forma
 *     case-insensitive sobre nombre/correo/empresa conservando el mismo orden.
 *
 * Estados de carga, vacío y "sin resultados" se muestran completamente en
 * español a partir del catálogo central `es` (Requisitos 3.2, 12.1).
 */

/** Forma mínima del Cliente que consume la interfaz de listado. */
type ClientRow = {
  id: number
  name: string
  email: string
  phone?: string | null
  company?: string | null
  status?: string | null
  lastActivityAt?: string | Date | null
}

const styles = {
  page: { maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' } as const,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  } as const,
  nav: { display: 'flex', gap: '1rem', alignItems: 'center' } as const,
  searchBar: { display: 'flex', gap: '0.5rem', margin: '1.5rem 0' } as const,
  searchInput: { flex: 1, padding: '0.5rem' } as const,
  list: { listStyle: 'none', padding: 0, margin: 0 } as const,
  item: {
    padding: '0.75rem 0',
    borderBottom: '1px solid #e2e2e2',
  } as const,
  itemName: { fontWeight: 600 } as const,
  itemLink: { textDecoration: 'none', color: 'inherit', display: 'block' } as const,
  itemMeta: { color: '#666', fontSize: '0.9rem' } as const,
  state: { color: '#666', margin: '1rem 0' } as const,
}

/** Formatea la marca de última actividad de forma legible (o cadena vacía). */
function formatLastActivity(value: ClientRow['lastActivityAt']): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es')
}

export function PaginaClientes() {
  // Término de búsqueda controlado por la barra superior.
  const [term, setTerm] = useState('')
  const trimmedTerm = term.trim()
  const isSearching = trimmedTerm.length > 0

  // Solo una de las dos consultas se ejecuta según haya o no término de
  // búsqueda activo (`enabled`), evitando peticiones redundantes.
  const clientsQuery = useQuery(getClients, undefined, { enabled: !isSearching })
  const searchQuery = useQuery(
    searchClients,
    { term: trimmedTerm },
    { enabled: isSearching }
  )

  const activeQuery = isSearching ? searchQuery : clientsQuery
  const clients = (activeQuery.data ?? []) as ClientRow[]
  const isLoading = activeQuery.isLoading
  const error = activeQuery.error

  // Mensaje de estado/vacío en español según el contexto actual.
  const emptyMessage = useMemo(() => {
    if (isSearching) return es.clients.search.noResults
    return es.clients.empty
  }, [isSearching])

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1>{es.clients.pageTitle}</h1>
        <NavBar active="clients" />
      </header>

      <div style={styles.searchBar}>
        <input
          style={styles.searchInput}
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={es.clients.search.placeholder}
          aria-label={es.clients.actions.search}
        />
      </div>

      {isLoading && <p style={styles.state}>{es.clients.loading}</p>}

      {!isLoading && error && (
        <p style={styles.state} role="alert">
          {es.errors.generic}
        </p>
      )}

      {!isLoading && !error && clients.length === 0 && (
        <p style={styles.state}>{emptyMessage}</p>
      )}

      {!isLoading && !error && clients.length > 0 && (
        <ul style={styles.list}>
          {clients.map((client) => {
            const lastActivity = formatLastActivity(client.lastActivityAt)
            return (
              <li key={client.id} style={styles.item}>
                <Link to={`/clientes/${client.id}`} style={styles.itemLink}>
                  <div style={styles.itemName}>{client.name}</div>
                  <div style={styles.itemMeta}>
                    {client.email}
                    {client.company ? ` · ${client.company}` : ''}
                    {client.phone ? ` · ${client.phone}` : ''}
                  </div>
                  {lastActivity && (
                    <div style={styles.itemMeta}>
                      {es.activity.title}: {lastActivity}
                    </div>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
