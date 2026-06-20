import { HttpError } from 'wasp/server'
import { requireUser, requireOwnership } from '../auth/ownership.js'

/**
 * Consultas del Publicador de Vídeos IA (Tarea 5.1).
 *
 * Todas las consultas respetan el aislamiento por propietario reutilizando las
 * guardas existentes `requireUser`/`requireOwnership`: filtran o verifican
 * siempre por `ownerId` (Requisitos 1.4, 4.1, 4.2).
 */

/** Forma mínima de una Publicacion_Video para las verificaciones de propiedad. */
type OwnedVideoPost = { id: number; ownerId: number }

/**
 * Lista las Publicacion_Video del Usuario autenticado, ordenadas por fecha de
 * creación descendente (Requisitos 1.4, 4.1).
 *
 * @returns Las Publicacion_Video cuyo propietario es el Usuario, en orden no
 *          creciente según `createdAt`.
 */
export const getVideoPosts = async (_args: unknown, context: any) => {
  const ownerId = requireUser(context)
  return context.entities.VideoPost.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Recupera una única Publicacion_Video propia del Usuario, verificando la
 * propiedad (Requisito 1.5), junto con sus Contenido_Plataforma asociados
 * (Requisito 4.2).
 *
 * @param args.id Identificador de la Publicacion_Video a recuperar.
 * @throws HttpError 400 si no se proporciona un identificador válido.
 * @throws HttpError 403 si la Publicacion_Video no existe o pertenece a otro Usuario.
 * @returns La Publicacion_Video con su campo `contents` (PlatformContent) incluido.
 */
export const getVideoPost = async ({ id }: { id: number }, context: any) => {
  const ownerId = requireUser(context)
  if (typeof id !== 'number' || Number.isNaN(id)) {
    throw new HttpError(400, 'Identificador de publicación no válido')
  }
  const post = await context.entities.VideoPost.findUnique({
    where: { id },
    include: { contents: true }
  })
  await requireOwnership(post as OwnedVideoPost | null, ownerId)
  return post
}
