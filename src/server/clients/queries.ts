import { HttpError } from 'wasp/server'
import { requireUser, requireOwnership } from '../auth/ownership.js'

/**
 * Consultas de Cliente (Tarea 4.3).
 *
 * Todas las consultas respetan el aislamiento por propietario: filtran o
 * verifican siempre por `ownerId` (Requisitos 1.4, 7.5). Las listas se
 * ordenan por la marca de tiempo de última actividad de forma descendente
 * (Requisito 2.6).
 */

/** Forma mínima de un Cliente persistido para las verificaciones de propiedad. */
type OwnedClient = { id: number; ownerId: number }

/**
 * Lista los Cliente del Agente autenticado, ordenados por actividad más
 * reciente (Requisitos 1.4, 2.6).
 *
 * @returns Los Cliente cuyo propietario es el Agente, en orden no creciente
 *          según `lastActivityAt`.
 */
export const getClients = async (_args: unknown, context: any) => {
  const ownerId = requireUser(context)
  return context.entities.Client.findMany({
    where: { ownerId },
    orderBy: { lastActivityAt: 'desc' }
  })
}

/**
 * Recupera un único Cliente propio del Agente, verificando la propiedad
 * (Requisito 1.4), junto con sus Registro_Actividad en orden cronológico
 * ascendente (Requisito 4.2).
 *
 * @param args.id Identificador del Cliente a recuperar.
 * @throws HttpError 400 si no se proporciona un identificador válido.
 * @throws HttpError 403 si el Cliente no existe o pertenece a otro Agente.
 * @returns El Cliente con un campo `activities` ordenado de forma no
 *          decreciente por `createdAt`.
 */
export const getClient = async ({ id }: { id: number }, context: any) => {
  const ownerId = requireUser(context)
  if (typeof id !== 'number' || Number.isNaN(id)) {
    throw new HttpError(400, 'Identificador de cliente no válido')
  }
  const client = await context.entities.Client.findUnique({ where: { id } })
  const owned = await requireOwnership(client as OwnedClient | null, ownerId)

  // Actividades del Cliente en orden cronológico ascendente (Requisito 4.2).
  const activities = await context.entities.Activity.findMany({
    where: { clientId: id },
    orderBy: { createdAt: 'asc' },
  })

  return { ...(owned as object), activities }
}

/**
 * Busca entre los Cliente del Agente cuyo nombre, correo electrónico o empresa
 * contengan el término sin distinguir mayúsculas de minúsculas (Requisito 3.1).
 *
 * @param args.term Término de búsqueda. Se normaliza recortando espacios.
 * @returns Los Cliente propios que coinciden, ordenados por actividad reciente.
 */
export const searchClients = async ({ term }: { term: string }, context: any) => {
  const ownerId = requireUser(context)
  const t = (term ?? '').trim()
  return context.entities.Client.findMany({
    where: {
      ownerId,
      OR: [
        { name: { contains: t, mode: 'insensitive' } },
        { email: { contains: t, mode: 'insensitive' } },
        { company: { contains: t, mode: 'insensitive' } }
      ]
    },
    orderBy: { lastActivityAt: 'desc' }
  })
}
