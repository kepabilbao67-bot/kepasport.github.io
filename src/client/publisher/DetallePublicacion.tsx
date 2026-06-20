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

import { useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getVideoPost,
  generatePlatformContent,
  publishPlatformContent,
  useQuery,
} from 'wasp/client/operations'
import { es } from '../i18n/es'

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
    </div>
  )
}

export default DetallePublicacion
