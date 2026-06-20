// Acciones del backend del Publicador de Vídeos IA (Tareas 6.1, 6.3, 6.5)
//
// Implementa las acciones de escritura del publicador sobre las entidades
// `VideoPost` (Publicacion_Video) y `PlatformContent` (Contenido_Plataforma):
//
//   - createVideoPost        (Tarea 6.1): crea la Publicacion_Video y un
//                             Contenido_Plataforma por plataforma seleccionada.
//   - generatePlatformContent (Tarea 6.3): genera con Claude y persiste/reemplaza
//                             el contenido de una plataforma.
//   - publishPlatformContent (Tarea 6.5): difunde la Carga_Publicacion a los
//                             destinos de salida y fija el Estado_Publicacion.
//   - markManual             (Tarea 6.5): fija explícitamente el estado `manual`.
//
// Todas las acciones exigen una sesión autenticada (`requireUser`, Req 1.2) y
// validan la propiedad de la Publicacion_Video dueña del Contenido_Plataforma
// (`requireOwnership`, Req 1.5) reutilizando `src/server/auth/ownership.ts`.
//
// NOTA: El cableado en `main.wasp` (entidades, operaciones) es una tarea
// posterior (8.1). Mientras tanto, los tipos generados por Wasp
// (`wasp/entities`, `wasp/server/operations`) aún no existen para el publicador,
// por lo que aquí se declaran tipos locales mínimos para `VideoPost`,
// `PlatformContent` y el contexto de Wasp. La firma de cada acción respeta el
// contrato `(args, context)` de las acciones de Wasp.

import { requireUser, requireOwnership } from '../auth/ownership.js'
import { validatePublicacion } from './validation.js'
import { esManual, type Platform } from './platforms.js'
import { generateContentForPlatform } from './aiContent.js'
import { publicarEnDestinos, type CargaPublicacion } from './dispatch.js'

// --- Tipos locales de entidades (espejo de las entidades Prisma del diseño) ---

/** Publicacion_Video persistida (espejo de la entidad `VideoPost`). */
interface VideoPost {
  id: number
  videoUrl: string
  fileRef: string | null
  brief: string
  ownerId: number
  createdAt: Date
}

/** Contenido_Plataforma persistido (espejo de la entidad `PlatformContent`). */
interface PlatformContent {
  id: number
  videoPostId: number
  platform: string
  title: string
  description: string
  hashtags: string
  status: string
  createdAt: Date
}

// --- Tipo mínimo del contexto de Wasp (acceso a entidades vía Prisma) ---

/** Delegado Prisma mínimo usado por estas acciones. */
interface PrismaDelegate<T> {
  create(args: { data: Record<string, unknown> }): Promise<T>
  findUnique(args: { where: { id: number } }): Promise<T | null>
  update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<T>
}

/** Contexto de Wasp inyectado en las acciones del publicador. */
interface PublisherContext {
  user?: { id: number }
  entities: {
    VideoPost: PrismaDelegate<VideoPost>
    PlatformContent: PrismaDelegate<PlatformContent>
  }
}

// --- Ayudante interno reutilizado por 6.3 y 6.5 -----------------------------

/**
 * Carga un Contenido_Plataforma y su Publicacion_Video padre, exigiendo que el
 * padre pertenezca al Agente autenticado (Req 1.5).
 *
 * Si el Contenido_Plataforma no existe, o su Publicacion_Video padre no existe
 * o pertenece a otro Agente, `requireOwnership` lanza `HttpError 403` ("Recurso
 * no disponible") sin revelar ni modificar nada (Req 1.5, Property 2).
 */
async function cargarContenidoPropio(
  platformContentId: number,
  ownerId: number,
  context: PublisherContext
): Promise<{ content: PlatformContent; videoPost: VideoPost }> {
  const content = await context.entities.PlatformContent.findUnique({
    where: { id: platformContentId },
  })

  // Si el contenido no existe se pasa `null` a `requireOwnership`, que lanza
  // 403 igual que para un recurso ajeno (no se distingue inexistente de ajeno).
  const videoPost = await requireOwnership(
    content
      ? await context.entities.VideoPost.findUnique({ where: { id: content.videoPostId } })
      : null,
    ownerId
  )

  // Llegados aquí `content` es necesariamente no nulo (de lo contrario
  // `requireOwnership` habría lanzado).
  return { content: content as PlatformContent, videoPost }
}

// --- Tarea 6.1: createVideoPost ---------------------------------------------

/** Argumentos de creación de una Publicacion_Video. */
interface CreateVideoPostArgs {
  videoUrl: string
  fileRef?: string
  brief: string
  platforms: string[]
}

/**
 * Crea una Publicacion_Video del Agente autenticado e inicializa un
 * Contenido_Plataforma por cada plataforma seleccionada (Req 1.3, 2.1, 2.2,
 * 2.5, 6.3).
 *
 * Flujo:
 *   1. `requireUser` → identificador del propietario (Req 1.2, 1.3).
 *   2. `validatePublicacion` rechaza URL vacía o selección de plataformas vacía
 *      en español antes de persistir nada (Req 2.3, 2.4, 7.1).
 *   3. Persiste la `VideoPost` asociada al `ownerId`, conservando `fileRef` si
 *      se proporciona (Req 2.1, 2.2).
 *   4. Crea un `PlatformContent` por plataforma seleccionada con título,
 *      descripción y hashtags vacíos; las plataformas manuales (Fiverr) quedan
 *      en estado `manual` y el resto en `pendiente` (Req 2.5, 6.3).
 *
 * @returns La Publicacion_Video creada con sus Contenido_Plataforma.
 */
export const createVideoPost = async (
  args: CreateVideoPostArgs,
  context: PublisherContext
): Promise<VideoPost & { contents: PlatformContent[] }> => {
  const ownerId = requireUser(context)

  // Validación de entrada antes de cualquier escritura (Req 2.3, 2.4, 7.1).
  validatePublicacion({
    videoUrl: args.videoUrl,
    fileRef: args.fileRef,
    brief: args.brief,
    platforms: args.platforms,
  })

  // Persiste la Publicacion_Video asociada al propietario, conservando fileRef.
  const videoPost = await context.entities.VideoPost.create({
    data: {
      videoUrl: args.videoUrl,
      fileRef: args.fileRef ?? null,
      brief: args.brief,
      ownerId,
    },
  })

  // Inicializa un Contenido_Plataforma por plataforma seleccionada. Las
  // plataformas manuales arrancan en `manual`; las automatizadas en `pendiente`.
  const contents: PlatformContent[] = []
  for (const platform of args.platforms) {
    const content = await context.entities.PlatformContent.create({
      data: {
        videoPostId: videoPost.id,
        platform,
        title: '',
        description: '',
        hashtags: '',
        status: esManual(platform as Platform) ? 'manual' : 'pendiente',
      },
    })
    contents.push(content)
  }

  return { ...videoPost, contents }
}

// --- Tarea 6.3: generatePlatformContent -------------------------------------

/** Argumentos de las acciones que operan sobre un Contenido_Plataforma. */
interface PlatformContentArgs {
  platformContentId: number
}

/**
 * Genera (o regenera) el contenido de un Contenido_Plataforma con el
 * Proveedor_Claude y persiste el resultado, reemplazando por completo el
 * contenido previo (Req 1.5, 3.1, 3.3, 3.4, 3.6).
 *
 * Conservación ante error (Req 3.6): la generación se realiza ANTES de escribir
 * en la base de datos. Si `generateContentForPlatform` lanza (p. ej. error del
 * proveedor o falta de clave de API), el error se propaga y el Contenido_Plataforma
 * almacenado permanece sin cambios.
 *
 * @returns El Contenido_Plataforma actualizado.
 */
export const generatePlatformContent = async (
  args: PlatformContentArgs,
  context: PublisherContext
): Promise<PlatformContent> => {
  const ownerId = requireUser(context)
  const { content, videoPost } = await cargarContenidoPropio(
    args.platformContentId,
    ownerId,
    context
  )

  // Generar ANTES de escribir (Req 3.6): si esto lanza, el contenido previo
  // queda intacto porque aún no se ha tocado la base de datos.
  const generado = await generateContentForPlatform(
    videoPost.brief,
    videoPost.videoUrl,
    content.platform as Platform
  )

  // Reemplaza por completo título, descripción y hashtags (Req 3.4).
  return context.entities.PlatformContent.update({
    where: { id: content.id },
    data: {
      title: generado.title,
      description: generado.description,
      hashtags: generado.hashtags,
    },
  })
}

// --- Tarea 6.5: publishPlatformContent y markManual -------------------------

/**
 * Publica un Contenido_Plataforma difundiendo la Carga_Publicacion a los
 * destinos de salida y fija el Estado_Publicacion resultante (Req 1.5, 5.1,
 * 5.3, 5.4, 5.5, 4.3).
 *
 * Transiciones de estado:
 *   - `total === 0`   → `manual`  (no hay destinos configurados, Req 5.5).
 *   - `fallidos === 0`→ `enviado` (todos los envíos correctos, Req 5.3).
 *   - `fallidos > 0`  → `error`   (al menos un destino falló; los demás se
 *                                   intentaron igualmente, Req 5.4).
 *
 * @returns El Contenido_Plataforma con el Estado_Publicacion actualizado.
 */
export const publishPlatformContent = async (
  args: PlatformContentArgs,
  context: PublisherContext
): Promise<PlatformContent> => {
  const ownerId = requireUser(context)
  const { content, videoPost } = await cargarContenidoPropio(
    args.platformContentId,
    ownerId,
    context
  )

  // Construye la Carga_Publicacion con la URL del vídeo y el contenido actual.
  const carga: CargaPublicacion = {
    platform: content.platform,
    videoUrl: videoPost.videoUrl,
    content: {
      title: content.title,
      description: content.description,
      hashtags: content.hashtags,
    },
  }

  // Difunde a los destinos resueltos con aislamiento de fallo por destino.
  const { total, fallidos } = await publicarEnDestinos(carga)

  const status = total === 0 ? 'manual' : fallidos === 0 ? 'enviado' : 'error'

  return context.entities.PlatformContent.update({
    where: { id: content.id },
    data: { status },
  })
}

/**
 * Fija explícitamente el Estado_Publicacion de un Contenido_Plataforma a
 * `manual` (Req 6.3), tras verificar sesión y propiedad (Req 1.5).
 *
 * @returns El Contenido_Plataforma con estado `manual`.
 */
export const markManual = async (
  args: PlatformContentArgs,
  context: PublisherContext
): Promise<PlatformContent> => {
  const ownerId = requireUser(context)
  const { content } = await cargarContenidoPropio(
    args.platformContentId,
    ownerId,
    context
  )

  return context.entities.PlatformContent.update({
    where: { id: content.id },
    data: { status: 'manual' },
  })
}
