// Pruebas por ejemplo de la UI: DetallePublicacion (Tarea 9.6).
//
// Cubren el comportamiento observable del detalle de una Publicacion_Video:
//   - (Req 6.1, 6.2) Copiar texto en plataformas manuales (Fiverr): el botón
//     "Copiar texto" copia `título\n\n descripción\n\n hashtags` al portapapeles
//     del navegador (`navigator.clipboard.writeText` mockeado) y muestra la
//     confirmación "Texto copiado" en español.
//   - (Req 7.2) Visualización de errores del backend en español: cuando
//     `generatePlatformContent` rechaza con un mensaje en español, la tarjeta
//     muestra ese mensaje en un `role="alert"`.
//   - (Req 9.2) Las etiquetas de estado se muestran traducidas al español.
//
// Se reutiliza la infraestructura de pruebas de UI del repo (vitest + jsdom,
// @testing-library/react). Las dependencias de Wasp y `react-router-dom` se
// sustituyen por dobles de prueba, igual que en `DetalleCliente.test.tsx`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { es } from '../i18n/es'

const useQueryMock = vi.fn()
const generatePlatformContentMock = vi.fn()
const publishPlatformContentMock = vi.fn()

vi.mock('wasp/client/operations', () => ({
  getVideoPost: 'getVideoPost',
  generatePlatformContent: (...args: unknown[]) =>
    generatePlatformContentMock(...args),
  publishPlatformContent: (...args: unknown[]) =>
    publishPlatformContentMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
  // El componente lee el `:id` de la ruta; devolvemos uno válido.
  useParams: () => ({ id: '1' }),
}))

import { DetallePublicacion } from './DetallePublicacion'

/** Crea una Publicacion_Video con los contenidos por plataforma indicados. */
function makePost(contents: Array<Record<string, unknown>>) {
  return {
    id: 1,
    videoUrl: 'https://videos.example.com/clip.mp4',
    fileRef: null,
    brief: 'Lanzamiento de producto',
    ownerId: 1,
    createdAt: new Date('2024-01-01T09:00:00Z'),
    contents,
  }
}

describe('DetallePublicacion — pruebas por ejemplo de la UI (Tarea 9.6)', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    generatePlatformContentMock.mockReset()
    publishPlatformContentMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('(Req 6.1, 6.2) copia el texto de una plataforma manual (Fiverr) al portapapeles y confirma en español', async () => {
    const fiverr = {
      id: 42,
      videoPostId: 1,
      platform: 'fiverr',
      title: 'Título Fiverr',
      description: 'Descripción del servicio',
      hashtags: '#video #ia',
      status: 'manual',
    }
    useQueryMock.mockReturnValue({
      data: makePost([fiverr]),
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    })

    // Mock del portapapeles del navegador (ausente en jsdom por defecto).
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText: writeTextMock },
    })

    render(<DetallePublicacion />)

    // La etiqueta de estado se muestra traducida al español (Req 9.2).
    expect(screen.getByText(es.publisher.status.manual)).toBeInTheDocument()

    // El control de copiar está presente en la plataforma manual (Req 6.1).
    const copyButton = screen.getByRole('button', {
      name: es.publisher.actions.copy,
    })
    expect(copyButton).toBeInTheDocument()

    fireEvent.click(copyButton)

    // Se copia título + descripción + hashtags al portapapeles (Req 6.2).
    const textoEsperado = `${fiverr.title}\n\n${fiverr.description}\n\n${fiverr.hashtags}`
    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith(textoEsperado)
    )

    // Aparece la confirmación de copia en español (Req 6.2).
    expect(
      await screen.findByText(es.publisher.actions.copied)
    ).toBeInTheDocument()
  })

  it('(Req 7.2) muestra en español el error del backend al generar contenido en una plataforma automatizada', async () => {
    const linkedin = {
      id: 7,
      videoPostId: 1,
      platform: 'linkedin',
      title: '',
      description: '',
      hashtags: '',
      status: 'pendiente',
    }
    useQueryMock.mockReturnValue({
      data: makePost([linkedin]),
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    })

    // El backend rechaza la generación con un mensaje en español (Req 7.2).
    const mensaje = 'No se pudo generar el contenido en este momento'
    generatePlatformContentMock.mockRejectedValue(new Error(mensaje))

    render(<DetallePublicacion />)

    // La etiqueta de estado se muestra traducida al español (Req 9.2).
    expect(screen.getByText(es.publisher.status.pendiente)).toBeInTheDocument()

    // Sin contenido previo, el botón es "Generar" (Req 3.1).
    const generateButton = screen.getByRole('button', {
      name: es.publisher.actions.generate,
    })
    fireEvent.click(generateButton)

    await waitFor(() =>
      expect(generatePlatformContentMock).toHaveBeenCalledWith({
        platformContentId: linkedin.id,
      })
    )

    // El mensaje de error del backend se muestra en un `role="alert"` (Req 7.2).
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(mensaje)
  })
})
