// Componente DetallePublicacion (Tarea 9.5)
//
// Muestra el detalle de una Publicacion_Video propia del Usuario: su
// Fuente_Video (videoUrl), su `brief` y una tarjeta por cada Contenido_Plataforma
// (`PlatformContent`) con su Estado_Publicacion traducido al español.
//
// Requisitos cubiertos:
//   - 4.2: muestra la Publicacion_Video propia con sus Contenido_Plataforma.
//   - 3.1: botón "Generar" que invoca `generatePlatformContent`.
//   - 3.4: botón "Regenerar" cuando ya existe contenido previo (lo reemplaza).
//   - 5.1: botón "Publicar" (plataformas automatizadas) → `publishPlatformContent`.
//   - 6.1, 6.2: botón "Copiar texto" (plataformas manuales, Fiverr) que copia
//     título + descripción + hashtags al portapapeles del navegador.
//   - 7.2: los errores del backend se muestran en español.
//   - 9.1: todas las etiquetas se consumen del catálogo `es.publisher`.
//   - 9.2: el Estado_Publicacion se traduce vía `es.publisher.status[status]`.
//
// Consume las operaciones de Wasp (Wasp 0.13):
//   - query  getVideoPost            → `{ ...post, contents }` (Tarea 5.1).
//   - action generatePlatformContent → genera/regenera el contenido (Tarea 6.3).
//   - action publishPlatformContent  → publica en destinos de salida (Tarea 6.5).

import { useState, useCallback, useReducer, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getVideoPost,
  generatePlatformContent,
  publishPlatformContent,
  useQuery,
} from 'wasp/client/operations'
import { getSessionId } from 'wasp/client/api'
import { es } from '../i18n/es'
import {
  streamReducer,
  initialStreamState,
  parseSseFrame,
} from '../chat/streamReducer'

/**
 * Estructura mínima de un Contenido_Plataforma tal como lo devuelve
 * `getVideoPost` (incluye sus `contents`).
 */
type PlatformContent = {
  id: number
  videoPostId: number
  platform: string
  title: string
  description: string
  hashtags: string
  status: string
  createdAt?: string | Date
}

/** Estructura de la Publicacion_Video con sus contenidos devuelta por `getVideoPost`. */
type VideoPostWithContents = {
  id: number
  videoUrl: string
  fileRef?: string | null
  brief: string
  ownerId?: number
  createdAt?: string | Date
  contents: PlatformContent[]
}

/**
 * Etiquetas de plataforma en español, alineadas con el mapa del backend
 * `src/server/publisher/platforms.ts`. Si llegara una clave desconocida se
 * muestra la propia clave como respaldo.
 */
const platformLabels: Record<string, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X/Twitter',
  tiktok: 'TikTok',
  fiverr: 'Fiverr',
}

/**
 * Plataformas manuales: replican `esManual` del backend. Fiverr es la única
 * Plataforma_Manual del MVP; el resto se tratan como automatizadas.
 */
const MANUAL_PLATFORMS = new Set<string>(['fiverr'])

function esManualPlatform(platform: string): boolean {
  return MANUAL_PLATFORMS.has(platform)
}

/** Traduce un Estado_Publicacion al español, con respaldo a la clave cruda (Req 9.2). */
function traducirEstado(status: string): string {
  const labels = es.publisher.status as Record<string, string>
  return labels[status] ?? status
}

/** Indica si un Contenido_Plataforma ya tiene contenido generado (Req 3.4). */
function tieneContenido(content: PlatformContent): boolean {
  return Boolean(content.title?.trim() || content.description?.trim())
}

const containerStyle: React.CSSProperties = {
  maxWidth: '960px',
  margin: '2rem auto',
  padding: '0 1rem',
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '1rem',
  marginBottom: '1rem',
}

// ---------------------------------------------------------------------------
// AsistenteAutomatizacion — panel colapsable integrado en DetallePublicacion
//
// Permite al usuario hacer preguntas sobre automatización (n8n, Make, Zapier,
// APIs de redes sociales) en el contexto de la publicación que está viendo.
// Se comunica con el endpoint POST /api/automation/ask mediante SSE.
// ---------------------------------------------------------------------------

type AsistenteProps = {
  post: VideoPostWithContents
}

type Mensaje = {
  id: number
  role: 'user' | 'assistant' | 'info'
  content: string
}

function AsistenteAutomatizacion({ post }: AsistenteProps) {
  const t = es.automationAssistant
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamState, dispatch] = useReducer(streamReducer, initialStreamState)
  const streamTextRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)

  // Pre-fill con la primera plataforma disponible.
  const primeraPlataforma = post.contents[0]?.platform ?? ''
  const sugerencia = primeraPlataforma
    ? `¿Cómo configuro n8n para publicar en ${platformLabels[primeraPlataforma] ?? primeraPlataforma}?`
    : t.placeholder
  const [pregunta, setPregunta] = useState(sugerencia)

  const abrirPanel = useCallback(() => {
    setAbierto(true)
    // Mostrar la línea de contexto la primera vez que se abre.
    if (mensajes.length === 0) {
      setMensajes([{ id: Date.now(), role: 'info', content: t.contextLabel }])
    }
  }, [mensajes.length, t.contextLabel])

  const cerrarPanel = useCallback(() => {
    setAbierto(false)
    abortRef.current?.abort()
  }, [])

  const enviar = useCallback(async () => {
    const texto = pregunta.trim()
    if (!texto || streaming) {
      if (!texto) {
        setMensajes((prev) => [
          ...prev,
          { id: Date.now(), role: 'info', content: t.errorEmpty },
        ])
      }
      return
    }

    const postContext = {
      videoUrl: post.videoUrl,
      brief: post.brief,
      platform: post.contents[0]?.platform,
      status: post.contents[0]?.status,
    }

    // Mensaje del usuario de forma optimista.
    const idUsuario = Date.now()
    setMensajes((prev) => [
      ...prev,
      { id: idUsuario, role: 'user', content: texto },
    ])
    setPregunta('')
    dispatch({ type: 'reset' })
    streamTextRef.current = ''

    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      const sessionId = getSessionId()
      if (sessionId) headers['Authorization'] = `Bearer ${sessionId}`

      const response = await fetch('/api/automation/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: texto, postContext }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        setMensajes((prev) => [
          ...prev,
          { id: Date.now(), role: 'info', content: t.errorApi },
        ])
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const event = parseSseFrame(frame)
          if (!event) continue

          if (event.type === 'token') {
            streamTextRef.current += event.data
            dispatch({ type: 'append', chunk: event.data })
          } else if (event.type === 'done') {
            setMensajes((prev) => [
              ...prev,
              {
                id: Date.now(),
                role: 'assistant',
                content: streamTextRef.current,
              },
            ])
            dispatch({ type: 'reset' })
            streamTextRef.current = ''
          } else if (event.type === 'error') {
            setMensajes((prev) => [
              ...prev,
              {
                id: Date.now(),
                role: 'info',
                content: event.data.message || t.errorApi,
              },
            ])
            dispatch({ type: 'reset' })
            streamTextRef.current = ''
          }
        }
      }

      // Trama residual.
      const tail = buffer.trim()
      if (tail) {
        const event = parseSseFrame(tail)
        if (event?.type === 'token') {
          streamTextRef.current += event.data
          dispatch({ type: 'append', chunk: event.data })
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setMensajes((prev) => [
          ...prev,
          { id: Date.now(), role: 'info', content: t.errorApi },
        ])
      }
      dispatch({ type: 'reset' })
      streamTextRef.current = ''
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }, [pregunta, streaming, post, t])

  return (
    <div
      style={{
        borderTop: '2px solid #dee2e6',
        marginTop: '2rem',
        paddingTop: '1.5rem',
        backgroundColor: '#f8f9fa',
        borderRadius: '0 0 8px 8px',
        padding: '1.5rem 1rem',
      }}
    >
      {/* Botón de apertura / cierre */}
      <button
        type="button"
        onClick={abierto ? cerrarPanel : abrirPanel}
        style={{ marginBottom: abierto ? '1rem' : 0 }}
      >
        {abierto ? t.buttonClose : t.buttonOpen}
      </button>

      {abierto && (
        <div>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 1rem' }}>{t.title}</h2>

          {/* Lista de mensajes */}
          <div
            role="log"
            aria-live="polite"
            style={{
              minHeight: '120px',
              maxHeight: '320px',
              overflowY: 'auto',
              marginBottom: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {mensajes.map((m) => {
              if (m.role === 'info') {
                return (
                  <p
                    key={m.id}
                    style={{
                      margin: 0,
                      color: '#6c757d',
                      fontSize: '0.875rem',
                      fontStyle: 'italic',
                    }}
                  >
                    {m.content}
                  </p>
                )
              }
              return (
                <div
                  key={m.id}
                  style={{ textAlign: m.role === 'user' ? 'right' : 'left' }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.4rem 0.7rem',
                      borderRadius: '0.5rem',
                      background: m.role === 'user' ? '#e3f2fd' : '#ffffff',
                      border: '1px solid #dee2e6',
                      whiteSpace: 'pre-wrap',
                      maxWidth: '80%',
                    }}
                  >
                    {m.content}
                  </span>
                </div>
              )
            })}

            {/* Respuesta acumulándose en tiempo real */}
            {streaming && (
              <div style={{ textAlign: 'left' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.4rem 0.7rem',
                    borderRadius: '0.5rem',
                    background: '#ffffff',
                    border: '1px solid #dee2e6',
                    whiteSpace: 'pre-wrap',
                    maxWidth: '80%',
                  }}
                >
                  {streamState.text || t.thinking}
                </span>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void enviar()
            }}
            style={{ display: 'flex', gap: '0.5rem' }}
          >
            <input
              type="text"
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              placeholder={t.placeholder}
              disabled={streaming}
              style={{ flex: 1, padding: '0.5rem' }}
            />
            <button type="submit" disabled={streaming || !pregunta.trim()}>
              {t.send}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export function DetallePublicacion() {
  // El identificador de la Publicacion_Video se toma del parámetro de ruta `:id`.
  const params = useParams<{ id: string }>()
  const postId = Number(params.id)
  const hasValidId = Number.isFinite(postId)

  const {
    data: post,
    isLoading,
    error,
    refetch,
  } = useQuery(
    getVideoPost,
    { id: postId },
    { enabled: hasValidId }
  ) as {
    data?: VideoPostWithContents
    isLoading: boolean
    error?: { message?: string }
    refetch: () => void
  }

  // Estado por Contenido_Plataforma: acción en curso, error del backend y
  // confirmación de copia al portapapeles.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [contentErrors, setContentErrors] = useState<Record<number, string>>({})
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const setContentError = useCallback((id: number, message: string | null) => {
    setContentErrors((prev) => {
      const next = { ...prev }
      if (message === null) {
        delete next[id]
      } else {
        next[id] = message
      }
      return next
    })
  }, [])

  /** Genera o regenera el contenido de una plataforma (Req 3.1, 3.4). */
  const handleGenerate = useCallback(
    async (content: PlatformContent) => {
      setBusyId(content.id)
      setContentError(content.id, null)
      try {
        await generatePlatformContent({ platformContentId: content.id })
        refetch()
      } catch (err: any) {
        // Los errores del backend se muestran en español (Req 7.2).
        setContentError(content.id, err?.message ?? es.errors.generic)
      } finally {
        setBusyId(null)
      }
    },
    [refetch, setContentError]
  )

  /** Publica el contenido de una plataforma automatizada (Req 5.1). */
  const handlePublish = useCallback(
    async (content: PlatformContent) => {
      setBusyId(content.id)
      setContentError(content.id, null)
      try {
        await publishPlatformContent({ platformContentId: content.id })
        refetch()
      } catch (err: any) {
        setContentError(content.id, err?.message ?? es.errors.generic)
      } finally {
        setBusyId(null)
      }
    },
    [refetch, setContentError]
  )

  /**
   * Copia el texto del contenido (título + descripción + hashtags) al
   * portapapeles para las plataformas manuales (Req 6.1, 6.2).
   */
  const handleCopy = useCallback(
    async (content: PlatformContent) => {
      setContentError(content.id, null)
      const texto = `${content.title}\n\n${content.description}\n\n${content.hashtags}`
      try {
        await navigator.clipboard.writeText(texto)
        setCopiedId(content.id)
        // La confirmación se oculta tras unos segundos.
        window.setTimeout(() => {
          setCopiedId((prev) => (prev === content.id ? null : prev))
        }, 2000)
      } catch (err: any) {
        setContentError(content.id, err?.message ?? es.errors.generic)
      }
    },
    [setContentError]
  )

  // --- Renderizado ---

  if (!hasValidId) {
    return (
      <div style={containerStyle}>
        <p>{es.errors.resourceUnavailable}</p>
        <Link to="/publicaciones">{es.publisher.pageTitle}</Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p>{es.publisher.loading}</p>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div style={containerStyle}>
        <p>{error?.message ?? es.errors.resourceUnavailable}</p>
        <Link to="/publicaciones">{es.publisher.pageTitle}</Link>
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
        <h1>{es.publisher.pageTitle}</h1>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/publicaciones">{es.publisher.pageTitle}</Link>
        </nav>
      </header>

      {/* Campos de la Publicacion_Video: Fuente_Video y brief (Req 4.2). */}
      <section aria-label={es.publisher.fields.videoUrl}>
        <dl>
          <dt>{es.publisher.fields.videoUrl}</dt>
          <dd>
            <a href={post.videoUrl} target="_blank" rel="noopener noreferrer">
              {post.videoUrl}
            </a>
          </dd>
          {post.fileRef ? (
            <>
              <dt>{es.publisher.fields.fileRef}</dt>
              <dd>{post.fileRef}</dd>
            </>
          ) : null}
          <dt>{es.publisher.fields.brief}</dt>
          <dd>{post.brief}</dd>
        </dl>
      </section>

      {/* Una tarjeta por Contenido_Plataforma (Req 4.2, 9.2). */}
      <section aria-label={es.publisher.fields.platforms} style={{ marginTop: '1.5rem' }}>
        {post.contents.length === 0 ? (
          <p>{es.publisher.empty}</p>
        ) : (
          post.contents.map((content) => {
            const manual = esManualPlatform(content.platform)
            const yaTieneContenido = tieneContenido(content)
            const busy = busyId === content.id
            const contentError = contentErrors[content.id]

            return (
              <article key={content.id} style={cardStyle}>
                <header
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <h2 style={{ margin: 0 }}>
                    {platformLabels[content.platform] ?? content.platform}
                  </h2>
                  <span style={{ color: '#666', fontSize: '0.9rem' }}>
                    {traducirEstado(content.status)}
                  </span>
                </header>

                {yaTieneContenido ? (
                  <div style={{ margin: '0.75rem 0' }}>
                    {content.title ? (
                      <p style={{ margin: '0.25rem 0', fontWeight: 600 }}>
                        {content.title}
                      </p>
                    ) : null}
                    {content.description ? (
                      <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                        {content.description}
                      </p>
                    ) : null}
                    {content.hashtags ? (
                      <p style={{ margin: '0.25rem 0', color: '#1a73e8' }}>
                        {content.hashtags}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {/* Generar / Regenerar (Req 3.1, 3.4). */}
                  <button
                    type="button"
                    onClick={() => handleGenerate(content)}
                    disabled={busy}
                  >
                    {yaTieneContenido
                      ? es.publisher.actions.regenerate
                      : es.publisher.actions.generate}
                  </button>

                  {manual ? (
                    /* Plataforma manual (Fiverr): copiar texto (Req 6.1, 6.2). */
                    <button
                      type="button"
                      onClick={() => handleCopy(content)}
                      disabled={!yaTieneContenido}
                    >
                      {es.publisher.actions.copy}
                    </button>
                  ) : (
                    /* Plataforma automatizada: publicar (Req 5.1). */
                    <button
                      type="button"
                      onClick={() => handlePublish(content)}
                      disabled={busy}
                    >
                      {es.publisher.actions.publish}
                    </button>
                  )}
                </div>

                {copiedId === content.id ? (
                  <p role="status" style={{ color: 'green', margin: '0.5rem 0 0' }}>
                    {es.publisher.actions.copied}
                  </p>
                ) : null}

                {contentError ? (
                  <p role="alert" style={{ color: 'crimson', margin: '0.5rem 0 0' }}>
                    {contentError}
                  </p>
                ) : null}
              </article>
            )
          })
        )}
      </section>

      {/* Panel del asistente de automatización (colapsable, al pie de la página). */}
      <AsistenteAutomatizacion post={post} />
    </div>
  )
}

export default DetallePublicacion
