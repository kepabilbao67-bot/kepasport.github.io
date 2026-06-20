import { HttpError } from 'wasp/server'

/**
 * Garantiza que la solicitud proviene de un Agente autenticado.
 * Lanza HttpError 401 si no hay sesión (Requisito 1.2).
 * Devuelve el identificador del Agente propietario (Requisito 1.3).
 */
export function requireUser(context: { user?: { id: number } }): number {
  if (!context.user) throw new HttpError(401, 'No autorizado')
  return context.user.id
}

/**
 * Garantiza que el registro pertenece al Agente; si el registro es inexistente
 * o pertenece a otro Agente, lanza HttpError 403 (Requisito 1.4).
 */
export async function requireOwnership<T extends { ownerId: number }>(
  record: T | null,
  ownerId: number
): Promise<T> {
  if (!record || record.ownerId !== ownerId) {
    throw new HttpError(403, 'Recurso no disponible')
  }
  return record
}
