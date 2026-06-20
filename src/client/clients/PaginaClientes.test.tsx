// Pruebas por ejemplo del idioma de la UI: PaginaClientes (Tarea 14.7).
//
// Verifican que el componente renderiza etiquetas y mensajes de estado en
// español tomados del catálogo central `es.ts` (Requisitos 12.1), incluyendo
// el mensaje "No se encontraron resultados" de la búsqueda (Requisito 3.2).
//
// Las dependencias de Wasp (`wasp/client/operations`, `wasp/client/auth`) y de
// `react-router-dom` se sustituyen por dobles de prueba, de modo que el
// componente pueda renderizarse de forma aislada.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { es } from '../i18n/es'

// --- Dobles de prueba de las dependencias ----------------------------------

const useQueryMock = vi.fn()

vi.mock('wasp/client/operations', () => ({
  // Identificadores opacos: el componente los pasa a `useQuery`, que mockeamos.
  getClients: 'getClients',
  searchClients: 'searchClients',
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('wasp/client/auth', () => ({
  logout: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  // Enlace simplificado para no requerir un Router en las pruebas.
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

import { PaginaClientes } from './PaginaClientes'

describe('PaginaClientes — idioma de la UI (Tarea 14.7)', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
  })

  it('renderiza el listado con etiquetas en español', () => {
    const clientes = [
      {
        id: 1,
        name: 'Ana López',
        email: 'ana@example.com',
        company: 'Acme',
        lastActivityAt: new Date('2024-01-02T10:00:00Z'),
      },
    ]
    // No hay término de búsqueda: se usa la consulta `getClients`.
    useQueryMock.mockImplementation((queryFn: string) => {
      if (queryFn === 'getClients') {
        return { data: clientes, isLoading: false, error: undefined }
      }
      return { data: [], isLoading: false, error: undefined }
    })

    render(<PaginaClientes />)

    // Título de la página y etiquetas de navegación en español.
    expect(
      screen.getByRole('heading', { name: es.clients.pageTitle })
    ).toBeInTheDocument()
    expect(screen.getByText(es.app.nav.assistant)).toBeInTheDocument()
    expect(screen.getByText(es.app.nav.logout)).toBeInTheDocument()

    // Marcador de la barra de búsqueda en español.
    expect(
      screen.getByPlaceholderText(es.clients.search.placeholder)
    ).toBeInTheDocument()

    // Datos del cliente y etiqueta de actividad en español.
    expect(screen.getByText('Ana López')).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`^${es.activity.title}:`))
    ).toBeInTheDocument()
  })

  it('muestra "No se encontraron resultados" en español al buscar sin coincidencias', () => {
    // Toda consulta devuelve una lista vacía.
    useQueryMock.mockReturnValue({ data: [], isLoading: false, error: undefined })

    render(<PaginaClientes />)

    // Antes de buscar, el estado vacío del listado.
    expect(screen.getByText(es.clients.empty)).toBeInTheDocument()

    // Al escribir un término, se activa la búsqueda y se muestra el mensaje
    // de "sin resultados" en español (Requisito 3.2).
    const input = screen.getByPlaceholderText(es.clients.search.placeholder)
    fireEvent.change(input, { target: { value: 'inexistente' } })

    expect(screen.getByText(es.clients.search.noResults)).toBeInTheDocument()
  })

  it('muestra el mensaje de carga en español', () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: undefined })

    render(<PaginaClientes />)

    expect(screen.getByText(es.clients.loading)).toBeInTheDocument()
  })
})
