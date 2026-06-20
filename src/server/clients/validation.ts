import { HttpError } from 'wasp/server'

/**
 * Entrada de datos de un Cliente para crear o editar.
 * El nombre y el correo electrónico son obligatorios; el resto son opcionales.
 */
export type ClientInput = {
  name: string
  email: string
  phone?: string
  company?: string
  status?: string
  notes?: string
}

/**
 * Expresión regular para validar el formato de una dirección de correo
 * electrónico (Requisito 2.3).
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Valida la entrada de un Cliente antes de persistirla.
 *
 * - El nombre es obligatorio (Requisito 2.2).
 * - El correo electrónico es obligatorio (Requisito 2.2).
 * - El correo electrónico debe cumplir el formato de dirección (Requisito 2.3).
 *
 * Lanza `HttpError(400)` con un mensaje en español cuando la validación falla.
 */
export function validateClientInput(input: ClientInput): void {
  if (!input.name?.trim()) throw new HttpError(400, 'El nombre es obligatorio')
  if (!input.email?.trim()) throw new HttpError(400, 'El correo electrónico es obligatorio')
  if (!EMAIL_RE.test(input.email)) throw new HttpError(400, 'El formato del correo electrónico no es válido')
}

/**
 * Valida el contenido de un Registro_Actividad antes de persistirlo.
 *
 * - El contenido es obligatorio y no puede estar vacío ni compuesto solo por
 *   espacios en blanco (Requisito 4.3).
 *
 * Lanza `HttpError(400)` con un mensaje en español cuando la validación falla.
 */
export function validateActivityContent(content: string | undefined | null): void {
  if (!content?.trim()) {
    throw new HttpError(400, 'El contenido de la actividad es obligatorio')
  }
}
