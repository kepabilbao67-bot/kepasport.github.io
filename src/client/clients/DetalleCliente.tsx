// Componente DetalleCliente (Tarea 14.4)
//
// Muestra los campos de un Cliente propio y sus Registro_Actividad en orden
// cronológico, permite añadir notas/actividad, y ofrece botones para disparar
// las acciones del asistente "Redactar" y "Resumir" sobre el Cliente.
//
// Requisitos cubiertos:
//   - 4.2: las actividades se muestran en orden cronológico no decreciente.
//   - 6.1: la acción "Redactar" envía el contexto del Cliente al asistente.
//   - 6.2: la acción "Resumir" envía el Cliente y sus actividades al asistente.
//
// Consume las operaciones de Wasp (Wasp 0.13):
//   - query  getClient  → devuelve `{ ...client, activities }` (Tarea 5.1).
//   - action addActivity → crea una nota/actividad sobre el Cliente.
//
// Para "Redactar"/"Resumir" se invoca el endpoint SSE `POST /api/chat/stream`
// (declarado en main.wasp) con `{ intent, clientId, content }`, acumulando los
// tokens transmitidos de forma incremental (mismo contrato que `InterfazChat`).

import { useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getClient, addActivity, useQuery } from 'wasp/client/operations'
import { es } from '../i18n/es'

/** Estructura mínima de una actividad tal como la devuelve `getClient`. */
type Activity = {
  id: number
  content: string
  clientId: number
  createdAt: string | Date
}

/** Estructura del Cliente con sus actividades devuelta por `getClient`. */
type ClientWithActivities = {
  id: number
  name: string
  email: string
  phone?: string | null
  company?: string | null
  status?: string | null
  notes?: string | null
  lastActivityAt?: string | Date
  createdAt?: string | Date
  activities: Activity[]
}

/** Intenciones admitidas por el asistente para este componente. */
type AssistantIntent = 'draft' | 'summary'

/**
 * Resuelve la URL base de la API del backend de Wasp. En desarrollo el cliente
 * y el servidor pueden estar en orígenes distintos, por lo que se usa la
 * variable de entorno expuesta por Vite cuando está disponible.
 */
function resolveApiUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  return env?.REACT_APP_API_URL ?? ''
}

/**
 * Recupera, en la medida de lo posible, el token de sesión de Wasp almacenado
 * en el navegador para autenticar la solicitud al endpoint SSE. Si no se
 * encuentra, se devuelve `null` y la solicitud se apoya en las cookies de
 * sesión (`credentials: 'include'`).
 */
function getAuthToken(): string | null {
  try {
    return (
      window.localStorage.getItem('wasp:sessionId') ??
      window.localStorage.getItem('sessionId') ??
      null
    )
  } catch {
    return null
  }
}

/** Da formato legible (en español) a una marca de tiempo. */
function formatTimestamp(value: string | Date | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-ES')
}

const containerStyle: React.CSSProperties = {
  maxWidth: '960px',
  margin: '2rem auto',
  padding: '0 1rem',
}

export function DetalleCliente() {
  // El identificador del Cliente se toma del parámetro de ruta `:id`.
  const params = useParams<{ id: string }>()
  const clientId = Number(params.id)
  const hasValidId = Number.isFinite(clientId)

  const {
    data: client,
    isLoading,
    error,
    refetch,
  } = useQuery(
    getClient,
    { id: clientId },
    { enabled: hasValidId }
  ) as {
    data?: ClientWithActivities
    isLoading: boolean
    error?: { message?: string }
    refetch: () => void
  }

  // Estado del formulario de nueva nota/actividad.
  const [noteContent, setNoteContent] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [savingNote, setSavingNote] = useState(false)

  // Estado de las acciones del asistente (redactar/resumir).
  const [assistantText, setAssistantText] = useState('')
  const [assistantIntent, setAssistantIntent] = useState<AssistantIntent | null>(null)
  const [assistantStreaming, setAssistantStreaming] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)

  /** Añade una nota/actividad sobre el Cliente (acción `addActivity`). */
  const handleAddNote = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setNoteError(null)
      if (!noteContent.trim()) {
        // Validación de contenido vacío en el cliente (Requisito 4.3).
        setNoteError(es.errors.activityContentRequired)
        return
      }
      setSavingNote(true)
      try {
        await addActivity({ clientId, content: noteContent })
        setNoteContent('')
        refetch()
      } catch (err: any) {
        setNoteError(err?.message ?? es.errors.generic)
      } finally {
        setSavingNote(false)
      }
    },
    [clientId, noteContent, refetch]
  )

  /**
   * Dispara una acción del asistente ("Redactar" o "Resumir") para este
   * Cliente. Abre el endpoint SSE y acumula los tokens recibidos de forma
   * incremental, replicando el contrato de `InterfazChat`.
   */
  const runAssistant = useCallback(
    async (intent: AssistantIntent) => {
      if (!hasValidId) return
      setAssistantIntent(intent)
      setAssistantStreaming(true)
      setAssistantError(null)
      setAssistantText('')

      const prompt =
        intent === 'draft'
          ? 'Redacta un mensaje para este cliente.'
          : 'Resume la actividad de este cliente.'

      try {
        const token = getAuthToken()
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (token) headers['Authorization'] = `Bearer ${token}`

        const response = await fetch(`${resolveApiUrl()}/api/chat/stream`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ intent, clientId, content: prompt }),
        })

        if (!response.ok || !response.body) {
          throw new Error(es.errors.provider)
        }

        // Lectura incremental del stream SSE y acumulación de tokens.
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Los eventos SSE se separan por una línea en blanco.
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''

          for (const rawEvent of events) {
            const lines = rawEvent.split('\n')
            const eventLine = lines.find((l) => l.startsWith('event:'))
            const dataLine = lines.find((l) => l.startsWith('data:'))
            const eventType = eventLine?.slice('event:'.length).trim()
            const dataRaw = dataLine?.slice('data:'.length).trim()

            if (eventType === 'token' && dataRaw) {
              try {
                const tokenText = JSON.parse(dataRaw) as string
                setAssistantText((prev) => prev + tokenText)
              } catch {
                /* fragmento parcial: se ignora y se reintenta en el siguiente */
              }
            } else if (eventType === 'error') {
              setAssistantError(es.errors.provider)
            }
          }
        }
      } catch (err: any) {
        setAssistantError(err?.message ?? es.errors.provider)
      } finally {
        setAssistantStreaming(false)
      }
    },
    [clientId, hasValidId]
  )

  // --- Renderizado ---

  if (!hasValidId) {
    return (
      <div style={containerStyle}>
        <p>{es.errors.resourceUnavailable}</p>
        <Link to="/">{es.app.nav.clients}</Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p>{es.clients.loading}</p>
      </div>
    )
  }

  if (error || !client) {
    return (
      <div style={containerStyle}>
        <p>{error?.message ?? es.errors.resourceUnavailable}</p>
        <Link to="/">{es.app.nav.clients}</Link>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1>{client.name}</h1>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/">{es.app.nav.clients}</Link>
          <Link to="/chat">{es.app.nav.assistant}</Link>
        </nav>
      </header>

      {/* Campos del Cliente */}
      <section aria-label={es.clients.pageTitle}>
        <dl>
          <dt>{es.clients.fields.name}</dt>
          <dd>{client.name}</dd>
          <dt>{es.clients.fields.email}</dt>
          <dd>{client.email}</dd>
          {client.phone ? (
            <>
              <dt>{es.clients.fields.phone}</dt>
              <dd>{client.phone}</dd>
            </>
          ) : null}
          {client.company ? (
            <>
              <dt>{es.clients.fields.company}</dt>
              <dd>{client.company}</dd>
            </>
          ) : null}
          {client.status ? (
            <>
              <dt>{es.clients.fields.status}</dt>
              <dd>{client.status}</dd>
            </>
          ) : null}
          {client.notes ? (
            <>
              <dt>{es.clients.fields.notes}</dt>
              <dd>{client.notes}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {/* Acciones del asistente: Redactar / Resumir (Requisitos 6.1, 6.2) */}
      <section aria-label={es.chat.pageTitle} style={{ margin: '1.5rem 0' }}>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => runAssistant('draft')}
            disabled={assistantStreaming}
          >
            {es.chat.assistantActions.draft}
          </button>
          <button
            type="button"
            onClick={() => runAssistant('summary')}
            disabled={assistantStreaming}
          >
            {es.chat.assistantActions.summarize}
          </button>
        </div>

        {assistantStreaming ? (
          <p style={{ fontStyle: 'italic' }}>{es.chat.status.streaming}</p>
        ) : null}
        {assistantError ? (
          <p role="alert" style={{ color: 'crimson' }}>
            {assistantError}
          </p>
        ) : null}
        {assistantText ? (
          <div
            aria-live="polite"
            style={{
              whiteSpace: 'pre-wrap',
              border: '1px solid #ddd',
              borderRadius: '6px',
              padding: '0.75rem',
              marginTop: '0.5rem',
            }}
          >
            <strong>
              {assistantIntent === 'summary'
                ? es.chat.assistantActions.summarize
                : es.chat.assistantActions.draft}
            </strong>
            <p style={{ margin: '0.5rem 0 0' }}>{assistantText}</p>
          </div>
        ) : null}
      </section>

      {/* Registro de actividad en orden cronológico (Requisito 4.2) */}
      <section aria-label={es.activity.title} style={{ margin: '1.5rem 0' }}>
        <h2>{es.activity.title}</h2>

        <form onSubmit={handleAddNote} style={{ marginBottom: '1rem' }}>
          <label htmlFor="nota">{es.activity.addNote}</label>
          <textarea
            id="nota"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder={es.activity.notePlaceholder}
            rows={3}
            style={{ display: 'block', width: '100%', margin: '0.5rem 0' }}
          />
          {noteError ? (
            <p role="alert" style={{ color: 'crimson' }}>
              {noteError}
            </p>
          ) : null}
          <button type="submit" disabled={savingNote}>
            {es.activity.save}
          </button>
        </form>

        {client.activities.length === 0 ? (
          <p>{es.activity.empty}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {client.activities.map((activity) => (
              <li
                key={activity.id}
                style={{
                  borderBottom: '1px solid #eee',
                  padding: '0.5rem 0',
                }}
              >
                <time
                  dateTime={String(activity.createdAt)}
                  style={{ color: '#666', fontSize: '0.85rem' }}
                >
                  {formatTimestamp(activity.createdAt)}
                </time>
                <p style={{ margin: '0.25rem 0 0' }}>{activity.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default DetalleCliente
