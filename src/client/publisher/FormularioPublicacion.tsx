import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createVideoPost } from 'wasp/client/operations'

import { es } from '../i18n/es'

/**
 * Formulario de creación de una Publicacion_Video (Tarea 9.4).
 *
 * Permite a un Usuario autenticado preparar una nueva publicación indicando la
 * Fuente_Video (URL obligatoria y una referencia de archivo opcional), un
 * Brief (resumen del tema) y un conjunto de Plataforma_Objetivo seleccionadas
 * mediante casillas de verificación (Requisitos 2.1, 2.2).
 *
 * La validación se realiza en el cliente replicando las reglas del servidor
 * (`validatePublicacion`): la URL del vídeo no puede estar vacía (Requisito 2.3)
 * y debe seleccionarse al menos una plataforma (Requisito 2.4). Los mensajes se
 * muestran en español tomados del catálogo central `es.publisher.errors`
 * (Requisito 9.1).
 *
 * Al enviar se invoca la acción `createVideoPost`; si tiene éxito se navega al
 * detalle de la publicación creada (`/publicaciones/:id`). Los errores
 * devueltos por el backend se muestran en español y el botón de envío se
 * deshabilita mientras la operación está en curso (Requisito 7.2).
 */

/**
 * Catálogo de plataformas seleccionables con su etiqueta en español. Las claves
 * coinciden con las del mapa del servidor (`src/server/publisher/platforms.ts`)
 * para que la selección sea válida en el backend.
 */
const PLATAFORMAS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'x', label: 'X/Twitter' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'fiverr', label: 'Fiverr' },
]

/** Estado interno de los campos editables del formulario. */
interface CamposFormulario {
  videoUrl: string
  fileRef: string
  brief: string
}

/** Errores de validación por campo (en español). */
type ErroresCampo = Partial<Record<'videoUrl' | 'platforms', string>>

const styles = {
  form: { display: 'grid', gap: '0.75rem', maxWidth: '480px' } as const,
  label: { display: 'grid', gap: '0.25rem' } as const,
  error: { color: '#b00020', fontSize: '0.85rem' } as const,
  alert: { color: '#b00020', margin: 0 } as const,
  fieldset: { display: 'grid', gap: '0.25rem', border: 0, padding: 0, margin: 0 } as const,
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '0.5rem' } as const,
  actions: { display: 'flex', gap: '0.5rem' } as const,
}

export function FormularioPublicacion() {
  const navigate = useNavigate()

  const [campos, setCampos] = useState<CamposFormulario>({
    videoUrl: '',
    fileRef: '',
    brief: '',
  })
  const [plataformas, setPlataformas] = useState<string[]>([])
  const [errores, setErrores] = useState<ErroresCampo>({})
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  /** Actualiza un campo de texto concreto del formulario. */
  function actualizar<K extends keyof CamposFormulario>(campo: K, valor: string) {
    setCampos((prev) => ({ ...prev, [campo]: valor }))
  }

  /** Alterna la selección de una plataforma por su clave. */
  function alternarPlataforma(key: string) {
    setPlataformas((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    )
  }

  /**
   * Valida la URL del vídeo y la selección de plataformas en el cliente,
   * replicando las reglas del servidor (Requisitos 2.3, 2.4).
   */
  function validar(valores: CamposFormulario, seleccionadas: string[]): ErroresCampo {
    const resultado: ErroresCampo = {}
    if (!valores.videoUrl.trim()) {
      resultado.videoUrl = es.publisher.errors.videoUrlRequired
    }
    if (seleccionadas.length === 0) {
      resultado.platforms = es.publisher.errors.platformRequired
    }
    return resultado
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErrorEnvio(null)

    const erroresValidacion = validar(campos, plataformas)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) {
      return
    }

    // Normaliza la referencia de archivo opcional: cadena vacía -> undefined.
    const fileRefLimpio = campos.fileRef.trim()
    const payload = {
      videoUrl: campos.videoUrl.trim(),
      fileRef: fileRefLimpio.length > 0 ? fileRefLimpio : undefined,
      brief: campos.brief.trim(),
      platforms: plataformas,
    }

    setEnviando(true)
    try {
      const creado = await createVideoPost(payload)
      navigate(`/publicaciones/${creado.id}`)
    } catch (err) {
      // Muestra el mensaje del servidor (en español) o un error genérico.
      const mensaje =
        err instanceof Error && err.message ? err.message : es.errors.generic
      setErrorEnvio(mensaje)
    } finally {
      setEnviando(false)
    }
  }

  const etiquetaCampos = es.publisher.fields

  return (
    <form onSubmit={manejarEnvio} noValidate style={styles.form}>
      <h2>{es.publisher.newPost}</h2>

      {errorEnvio && (
        <p role="alert" style={styles.alert}>
          {errorEnvio}
        </p>
      )}

      <label style={styles.label}>
        <span>{etiquetaCampos.videoUrl}</span>
        <input
          type="url"
          value={campos.videoUrl}
          onChange={(e) => actualizar('videoUrl', e.target.value)}
          aria-invalid={errores.videoUrl != null}
        />
        {errores.videoUrl && (
          <span role="alert" style={styles.error}>
            {errores.videoUrl}
          </span>
        )}
      </label>

      <label style={styles.label}>
        <span>{etiquetaCampos.fileRef}</span>
        <input
          type="text"
          value={campos.fileRef}
          onChange={(e) => actualizar('fileRef', e.target.value)}
        />
      </label>

      <label style={styles.label}>
        <span>{etiquetaCampos.brief}</span>
        <textarea
          rows={3}
          value={campos.brief}
          onChange={(e) => actualizar('brief', e.target.value)}
        />
      </label>

      <fieldset style={styles.fieldset} aria-invalid={errores.platforms != null}>
        <legend>{etiquetaCampos.platforms}</legend>
        {PLATAFORMAS.map((plataforma) => (
          <label key={plataforma.key} style={styles.checkboxRow}>
            <input
              type="checkbox"
              value={plataforma.key}
              checked={plataformas.includes(plataforma.key)}
              onChange={() => alternarPlataforma(plataforma.key)}
            />
            <span>{plataforma.label}</span>
          </label>
        ))}
        {errores.platforms && (
          <span role="alert" style={styles.error}>
            {errores.platforms}
          </span>
        )}
      </fieldset>

      <div style={styles.actions}>
        <button type="submit" disabled={enviando}>
          {es.publisher.actions.create}
        </button>
      </div>
    </form>
  )
}

export default FormularioPublicacion
