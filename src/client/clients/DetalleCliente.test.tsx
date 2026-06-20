// Pruebas por ejemplo del idioma de la UI: DetalleCliente (Tarea 14.7).
//
// Verifican que el detalle de cliente renderiza los campos, el registro de
// actividad y las acciones del asistente con etiquetas en español tomadas del
// catálogo `es.ts` (Requisitos 12.1, 4.2, 6.1, 6.2).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { es } from '../i18n/es'

const useQueryMock = vi.fn()

vi.mock('wasp/client/operations', () => ({
  getClient: 'getClient',
  addActivity: vi.fn(),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
  // El componente lee el `:id` de la ruta; devolvemos uno válido.
  useParams: () => ({ id: '1' }),
}))

import { DetalleCliente } from './DetalleCliente'

describe('DetalleCliente — idioma de la UI (Tarea 14.7)', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
  })

  it('renderiza los campos, la actividad y las acciones del asistente en español', () => {
    const client = {
      id: 1,
      name: 'Ana López',
      email: 'ana@example.com',
      phone: '600123123',
      company: 'Acme',
      status: 'prospecto',
      notes: 'Cliente importante',
      activities: [
        {
          id: 10,
          content: 'Primera llamada',
          clientId: 1,
          createdAt: new Date('2024-01-01T09:00:00Z'),
        },
      ],
    }
    useQueryMock.mockReturnValue({
      data: client,
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    })

    render(<DetalleCliente />)

    // Etiquetas de campos del cliente en español.
    expect(screen.getByText(es.clients.fields.email)).toBeInTheDocument()
    expect(screen.getByText(es.clients.fields.phone)).toBeInTheDocument()

    // Sección y acciones del registro de actividad en español.
    expect(
      screen.getByRole('heading', { name: es.activity.title })
    ).toBeInTheDocument()
    expect(screen.getByText(es.activity.addNote)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: es.activity.save })
    ).toBeInTheDocument()
    expect(screen.getByText('Primera llamada')).toBeInTheDocument()

    // Acciones del asistente (Redactar / Resumir) en español (Requisitos 6.1, 6.2).
    expect(
      screen.getByRole('button', { name: es.chat.assistantActions.draft })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: es.chat.assistantActions.summarize })
    ).toBeInTheDocument()
  })

  it('muestra el estado de carga en español', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
      refetch: vi.fn(),
    })

    render(<DetalleCliente />)

    expect(screen.getByText(es.clients.loading)).toBeInTheDocument()
  })
})
