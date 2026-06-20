// Pruebas por ejemplo de la InterfazChat (Tarea 14.7).
//
// Cubren:
//   - El idioma de la UI: el componente renderiza etiquetas y textos en español
//     del catálogo `es.ts` (Requisitos 12.1).
//   - El manejo de errores del modelo: ante una trama SSE `event: error`, la
//     interfaz muestra un mensaje de error en español (Requisitos 9.3).
//
// El endpoint SSE se simula mockeando `fetch` global para que devuelva un
// cuerpo `ReadableStream` con una única trama de error. Las dependencias de
// Wasp y de `react-router-dom` se sustituyen por dobles de prueba.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { es } from '../i18n/es'

const useQueryMock = vi.fn()

vi.mock('wasp/client/operations', () => ({
  getConversations: 'getConversations',
  getMessages: 'getMessages',
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('wasp/client/auth', () => ({
  logout: vi.fn(),
}))

vi.mock('wasp/client/api', () => ({
  getSessionId: () => 'sesion-de-prueba',
}))

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

import { InterfazChat } from './InterfazChat'

/** Referencia estable reutilizada por el mock de `useQuery` (ver beforeEach). */
const SIN_DATOS: unknown[] = []

/** Crea una respuesta `fetch` cuyo cuerpo emite las tramas SSE indicadas. */
function respuestaSseConTramas(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  })
  return { ok: true, body } as unknown as Response
}

describe('InterfazChat — idioma y manejo de errores (Tarea 14.7)', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    // IMPORTANTE: devolver referencias ESTABLES. La InterfazChat sincroniza los
    // mensajes persistidos en un `useEffect` cuya dependencia es `data`; si el
    // mock devolviera un arreglo nuevo en cada render, el efecto se dispararía
    // en bucle. Reutilizamos el mismo arreglo vacío para evitarlo.
    useQueryMock.mockImplementation((queryFn: string) => {
      if (queryFn === 'getConversations') {
        return { data: SIN_DATOS, isLoading: false }
      }
      return { data: SIN_DATOS, isLoading: false }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renderiza la interfaz del asistente con textos en español', () => {
    render(<InterfazChat />)

    expect(
      screen.getByRole('heading', { name: es.chat.pageTitle })
    ).toBeInTheDocument()
    expect(screen.getByText(es.chat.intro)).toBeInTheDocument()
    expect(screen.getByText(es.chat.conversations.title)).toBeInTheDocument()
    expect(screen.getByText(es.chat.conversations.empty)).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(es.chat.composer.placeholder)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: es.chat.composer.send })
    ).toBeInTheDocument()
  })

  it('muestra un mensaje de error en español ante una trama SSE `event: error`', async () => {
    // El backend emite un evento de error; el mensaje proviene del catálogo es.ts.
    const errorFrame = `event: error\ndata: ${JSON.stringify({
      message: es.errors.provider,
    })}\n\n`
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuestaSseConTramas([errorFrame]))
    vi.stubGlobal('fetch', fetchMock)

    render(<InterfazChat />)

    // Escribir un mensaje y enviarlo.
    const input = screen.getByPlaceholderText(es.chat.composer.placeholder)
    fireEvent.change(input, { target: { value: 'Hola asistente' } })
    fireEvent.click(screen.getByRole('button', { name: es.chat.composer.send }))

    // Se invocó el endpoint SSE del asistente.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/stream')

    // La interfaz muestra el mensaje de error en español (Requisito 9.3).
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(es.errors.provider)
  })

  it('muestra el mensaje de error en español cuando la respuesta no es satisfactoria', async () => {
    // Una respuesta sin cuerpo / no `ok` también deriva en error en español.
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, body: null } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<InterfazChat />)

    const input = screen.getByPlaceholderText(es.chat.composer.placeholder)
    fireEvent.change(input, { target: { value: 'Otro mensaje' } })
    fireEvent.click(screen.getByRole('button', { name: es.chat.composer.send }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(es.errors.provider)
  })
})
