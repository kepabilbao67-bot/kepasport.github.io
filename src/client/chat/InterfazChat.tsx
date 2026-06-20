import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { getConversations, getMessages, useQuery } from 'wasp/client/operations'
import { getSessionId } from 'wasp/client/api'
import { es } from '../i18n/es'
import { NavBar } from '../components/NavBar'
import {
  streamReducer,
  initialStreamState,
  parseSseFrame,
} from './streamReducer'

// ---------------------------------------------------------------------------
// InterfazChat — Asistente conversacional con streaming SSE (Tarea 14.5)
//
// Implementa los Requisitos:
// - 5.3  Acumulación incremental de tokens en la interfaz mientras se transmite
//        la respuesta del asistente (reducer de concatenación).
// - 7.3  Listado de las conversaciones del Agente (vía `getConversations`).
// - 7.4  Carga de los mensajes de la conversación seleccionada en orden
//        cronológico (vía `getMessages`).
// - 9.3  Ante un evento SSE `error`, se muestra un mensaje de error en español
//        tomado del catálogo `es.ts`.
// - 12.1 Toda la interfaz se presenta en español usando el catálogo central.
//
// El endpoint de streaming es `POST /api/chat/stream`. Como `EventSource` solo
// permite peticiones GET, abrimos la conexión con `fetch` y leemos el cuerpo de
// la respuesta como un `ReadableStream`, parseando manualmente las tramas SSE
// (`event: token` / `event: done` / `event: error`).
// ---------------------------------------------------------------------------

/** Forma mínima de una Conversacion devuelta por `getConversations`. */
type Conversacion = {
  id: number
  createdAt: string | Date
  updatedAt: string | Date
}

/** Forma mínima de un Mensaje devuelto por `getMessages`. */
type Mensaje = {
  id: number
  role: 'user' | 'assistant'
  content: string
  conversationId: number
  createdAt: string | Date
}

/** Tipos de eventos SSE emitidos por el endpoint `chatStream`. */
// (definidos en ./streamReducer junto con el reducer y el parser de tramas)

/** Parámetros para abrir un flujo de chat. */
type StreamRequest = {
  conversationId?: number
  content: string
  intent?: 'chat' | 'draft' | 'summary'
  clientId?: number
}

/** Manejadores de los eventos de un flujo de chat. */
type StreamHandlers = {
  onToken: (token: string) => void
  onDone: (conversationId: number) => void
  onError: (message: string) => void
}

/**
 * Hook que encapsula la apertura y lectura del flujo SSE del asistente.
 *
 * Abre `POST /api/chat/stream` con `fetch`, lee el cuerpo como `ReadableStream`
 * y despacha cada trama SSE (`token` / `done` / `error`) a los manejadores. La
 * acumulación incremental del texto la realiza el llamador a través de
 * `onToken` (Requisito 5.3).
 */
function useChatStream() {
  const [streaming, setStreaming] = useState(false)
  // Mantenemos un AbortController para poder cancelar el flujo al desmontar.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const send = useCallback(
    async (req: StreamRequest, handlers: StreamHandlers) => {
      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        // Adjuntar la sesión de Wasp para autenticar el endpoint (auth: true).
        const sessionId = getSessionId()
        if (sessionId) headers['Authorization'] = `Bearer ${sessionId}`

        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers,
          body: JSON.stringify(req),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          handlers.onError(es.errors.provider)
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Bucle de lectura: acumulamos en `buffer` y separamos tramas por la
        // línea en blanco que delimita los eventos SSE (`\n\n`).
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
            if (event.type === 'token') handlers.onToken(event.data)
            else if (event.type === 'done') handlers.onDone(event.data.conversationId)
            else if (event.type === 'error') handlers.onError(event.data.message)
          }
        }

        // Procesar cualquier trama residual sin delimitador final.
        const tail = buffer.trim()
        if (tail) {
          const event = parseSseFrame(tail)
          if (event) {
            if (event.type === 'token') handlers.onToken(event.data)
            else if (event.type === 'done') handlers.onDone(event.data.conversationId)
            else if (event.type === 'error') handlers.onError(event.data.message)
          }
        }
      } catch (err) {
        // Una cancelación deliberada (desmontaje) no se reporta como error.
        if ((err as { name?: string })?.name !== 'AbortError') {
          handlers.onError(es.errors.provider)
        }
      } finally {
        abortRef.current = null
        setStreaming(false)
      }
    },
    []
  )

  return { send, streaming }
}

// --- Componente principal ---------------------------------------------------

export function InterfazChat() {
  const t = es.chat

  // Conversación seleccionada (undefined = conversación nueva sin persistir).
  const [conversacionActivaId, setConversacionActivaId] = useState<number | undefined>(undefined)
  const [borrador, setBorrador] = useState('')
  // Mensajes mostrados localmente (incluye el del usuario recién enviado y la
  // respuesta del asistente que se va acumulando token a token).
  const [mensajesLocales, setMensajesLocales] = useState<Mensaje[]>([])
  const [error, setError] = useState<string | null>(null)

  // Texto del asistente acumulado incrementalmente durante el streaming (Req 5.3).
  const [streamState, dispatch] = useReducer(streamReducer, initialStreamState)

  const { send, streaming } = useChatStream()

  // Ref para acceder al texto acumulado más reciente dentro de `onDone`.
  const streamTextRef = useRef('')
  useEffect(() => {
    streamTextRef.current = streamState.text
  }, [streamState.text])

  // Listado de conversaciones del Agente (Requisito 7.3).
  const {
    data: conversaciones,
    isLoading: cargandoConversaciones,
  } = useQuery(getConversations)

  // Mensajes de la conversación seleccionada (Requisito 7.4). Solo se consulta
  // cuando hay una conversación persistida seleccionada.
  const {
    data: mensajesPersistidos,
    isLoading: cargandoMensajes,
  } = useQuery(
    getMessages,
    { conversationId: conversacionActivaId as number },
    { enabled: conversacionActivaId != null }
  )

  // Sincronizar los mensajes persistidos al cambiar de conversación.
  useEffect(() => {
    if (conversacionActivaId == null) {
      setMensajesLocales([])
      return
    }
    if (mensajesPersistidos) {
      setMensajesLocales(mensajesPersistidos as Mensaje[])
    }
  }, [conversacionActivaId, mensajesPersistidos])

  const seleccionarConversacion = useCallback((id: number) => {
    setConversacionActivaId(id)
    setError(null)
    dispatch({ type: 'reset' })
  }, [])

  const nuevaConversacion = useCallback(() => {
    setConversacionActivaId(undefined)
    setMensajesLocales([])
    setError(null)
    dispatch({ type: 'reset' })
  }, [])

  const enviar = useCallback(async () => {
    const contenido = borrador.trim()
    if (!contenido || streaming) return

    setError(null)
    dispatch({ type: 'reset' })

    // Mostrar de inmediato el mensaje del usuario (optimista).
    const mensajeUsuario: Mensaje = {
      id: -Date.now(),
      role: 'user',
      content: contenido,
      conversationId: conversacionActivaId ?? -1,
      createdAt: new Date(),
    }
    setMensajesLocales((prev) => [...prev, mensajeUsuario])
    setBorrador('')

    await send(
      { conversationId: conversacionActivaId, content: contenido, intent: 'chat' },
      {
        onToken: (token) => dispatch({ type: 'append', chunk: token }),
        onDone: (conversationId) => {
          // Fijar la respuesta acumulada como mensaje del asistente.
          setMensajesLocales((prev) => [
            ...prev,
            {
              id: -Date.now() - 1,
              role: 'assistant',
              content: streamTextRef.current,
              conversationId,
              createdAt: new Date(),
            },
          ])
          dispatch({ type: 'reset' })
          // Seleccionar la conversación recién creada para refrescar el hilo.
          if (!Number.isNaN(conversationId)) {
            setConversacionActivaId(conversationId)
          }
        },
        onError: (mensaje) => {
          // Mensaje de error en español (Requisito 9.3).
          setError(mensaje || es.errors.provider)
          dispatch({ type: 'reset' })
        },
      }
    )
  }, [borrador, streaming, conversacionActivaId, send])

  const listaConversaciones = (conversaciones as Conversacion[] | undefined) ?? []

  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t.pageTitle}</h1>
        <NavBar active="assistant" />
      </header>

      <p>{t.intro}</p>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        {/* Panel lateral: listado de conversaciones (Requisito 7.3) */}
        <aside style={{ flex: '0 0 240px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem' }}>{t.conversations.title}</h2>
            <button onClick={nuevaConversacion}>{t.conversations.newConversation}</button>
          </div>

          {cargandoConversaciones ? (
            <p>{t.conversations.loading}</p>
          ) : listaConversaciones.length === 0 ? (
            <p>{t.conversations.empty}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {listaConversaciones.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => seleccionarConversacion(c.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontWeight: c.id === conversacionActivaId ? 'bold' : 'normal',
                    }}
                  >
                    {`#${c.id}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Hilo de mensajes y composer */}
        <section style={{ flex: 1 }}>
          {cargandoMensajes && conversacionActivaId != null ? (
            <p>{t.conversations.loading}</p>
          ) : (
            <div role="log" aria-live="polite" style={{ minHeight: '240px' }}>
              {mensajesLocales.map((m) => (
                <div
                  key={m.id}
                  style={{
                    margin: '0.5rem 0',
                    textAlign: m.role === 'user' ? 'right' : 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.4rem 0.7rem',
                      borderRadius: '0.5rem',
                      background: m.role === 'user' ? '#e3f2fd' : '#f1f1f1',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </span>
                </div>
              ))}

              {/* Respuesta del asistente acumulándose en tiempo real (Req 5.3) */}
              {streaming && (
                <div style={{ margin: '0.5rem 0', textAlign: 'left' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.4rem 0.7rem',
                      borderRadius: '0.5rem',
                      background: '#f1f1f1',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {streamState.text || t.status.thinking}
                  </span>
                </div>
              )}
            </div>
          )}

          {streaming && <p style={{ color: '#666' }}>{t.status.streaming}</p>}

          {/* Mensaje de error en español ante evento SSE `error` (Requisito 9.3) */}
          {error && (
            <p role="alert" style={{ color: '#c62828' }}>
              {error}
            </p>
          )}

          {/* Composer de envío de mensajes */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void enviar()
            }}
            style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}
          >
            <input
              type="text"
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              placeholder={t.composer.placeholder}
              disabled={streaming}
              style={{ flex: 1, padding: '0.5rem' }}
            />
            <button type="submit" disabled={streaming || !borrador.trim()}>
              {t.composer.send}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
