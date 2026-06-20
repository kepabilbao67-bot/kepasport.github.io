// Pruebas por ejemplo del idioma de la UI y validación: FormularioCliente
// (Tarea 14.7).
//
// Verifican que el formulario renderiza las etiquetas de campo en español
// (Requisito 12.1) y que, ante un envío inválido, muestra los mensajes de
// validación en español del catálogo `es.errors` (Requisitos 2.2, 2.3, 12.2).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { es } from '../i18n/es'

const createClientMock = vi.fn()
const updateClientMock = vi.fn()

vi.mock('wasp/client/operations', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  updateClient: (...args: unknown[]) => updateClientMock(...args),
}))

import { FormularioCliente } from './FormularioCliente'

describe('FormularioCliente — idioma de la UI y validación (Tarea 14.7)', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    updateClientMock.mockReset()
  })

  it('renderiza las etiquetas de campo y botones en español', () => {
    render(<FormularioCliente />)

    // Etiquetas de los campos del cliente.
    expect(screen.getByText(es.clients.fields.name)).toBeInTheDocument()
    expect(screen.getByText(es.clients.fields.email)).toBeInTheDocument()
    expect(screen.getByText(es.clients.fields.phone)).toBeInTheDocument()
    expect(screen.getByText(es.clients.fields.company)).toBeInTheDocument()
    expect(screen.getByText(es.clients.fields.status)).toBeInTheDocument()
    expect(screen.getByText(es.clients.fields.notes)).toBeInTheDocument()

    // Botón de guardar y título de "Nuevo cliente" en español.
    expect(
      screen.getByRole('button', { name: es.clients.actions.save })
    ).toBeInTheDocument()
    expect(screen.getByText(es.clients.newClient)).toBeInTheDocument()
  })

  it('muestra mensajes de validación en español al enviar campos vacíos', () => {
    render(<FormularioCliente />)

    // Enviar el formulario sin completar nombre ni correo.
    fireEvent.click(screen.getByRole('button', { name: es.clients.actions.save }))

    // Mensajes de validación en español (Requisitos 2.2, 12.2).
    expect(screen.getByText(es.errors.nameRequired)).toBeInTheDocument()
    expect(screen.getByText(es.errors.emailRequired)).toBeInTheDocument()

    // No debe invocarse la acción de creación con entrada inválida.
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('muestra el mensaje de formato de correo no válido en español', () => {
    render(<FormularioCliente />)

    // Completar el nombre (primer textbox) y un correo con formato inválido.
    const nameInput = document.querySelector(
      'input[type="text"]'
    ) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Ana' } })

    const emailInput = document.querySelector(
      'input[type="email"]'
    ) as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'correo-invalido' } })

    fireEvent.click(screen.getByRole('button', { name: es.clients.actions.save }))

    expect(screen.getByText(es.errors.emailInvalid)).toBeInTheDocument()
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
