// Pruebas basadas en propiedades para `generatePlatformContent` (Tarea 6.4).
//
// Feature: publicador-videos-ia
//
// Verifica la acción de backend `generatePlatformContent` de
// `src/server/publisher/actions.ts` a nivel de ACCIÓN, con un contexto de Wasp
// simulado en memoria (delegados Prisma `findUnique`/`update` para `VideoPost`
// y `PlatformContent`). La capa de IA (`./aiContent.js`) se mockea con `vi.mock`
// para que `generateContentForPlatform` devuelva un valor controlado o lance,
// sin llamar a Claude ni a la red.
//
// Propiedades cubiertas:
//   - Property 5: Generación produce y persiste contenido completo
//                 (Validates: Requirements 3.1, 3.3)
//   - Property 7: La regeneración reemplaza el contenido previo
//                 (Validates: Requirements 3.4)
//   - Property 9: Conservación del contenido ante error del proveedor
//                 (Validates: Requirements 3.6)
//
// La ÚNICA dependencia mockeada es `generateContentForPlatform` de la capa de
// IA. La lógica de la acción (carga, propiedad, persistencia) NO se mockea: se
// ejercita contra un Prisma en memoria fiel a la semántica de Wasp.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

import { PLATAFORMAS } from './platforms.js'

const NUM_RUNS = 100

// Espía de la capa de IA creado con `vi.hoisted` para referenciarlo dentro de
// la fábrica de `vi.mock` (que se eleva al inicio del módulo).
const { generarMock } = vi.hoisted(() => ({ generarMock: vi.fn() }))

// Mock de la capa de IA: `generatePlatformContent` (la acción) llama a
// `generateContentForPlatform`, que aquí devuelve el valor controlado por cada
// prueba o lanza un error simulado del proveedor.
vi.mock('./aiContent.js', () => ({
  generateContentForPlatform: (...args: unknown[]) => generarMock(...args),
}))

// Se importa DESPUÉS del `vi.mock` para que `actions.ts` reciba el mock.
import { generatePlatformContent } from './actions.js'

// --- Contexto de Wasp simulado en memoria -----------------------------------

interface VideoPostRow {
  id: number
  videoUrl: string
  fileRef: string | null
  brief: string
  ownerId: number
  createdAt: Date
}

interface PlatformContentRow {
  id: number
  videoPostId: number
  platform: string
  title: string
  description: string
  hashtags: string
  status: string
  createdAt: Date
}

/**
 * Construye un contexto de Wasp con un Prisma en memoria que contiene una
 * `VideoPost` (propiedad de `ownerId`) y un `PlatformContent` asociado. Los
 * delegados implementan `findUnique` y `update` (las únicas operaciones que usa
 * `generatePlatformContent`).
 */
function crearContexto(opciones: {
  ownerId: number
  videoUrl: string
  brief: string
  platform: string
  contenidoPrevio: { title: string; description: string; hashtags: string }
}) {
  const videoPost: VideoPostRow = {
    id: 1,
    videoUrl: opciones.videoUrl,
    fileRef: null,
    brief: opciones.brief,
    ownerId: opciones.ownerId,
    createdAt: new Date(),
  }

  const platformContent: PlatformContentRow = {
    id: 10,
    videoPostId: videoPost.id,
    platform: opciones.platform,
    title: opciones.contenidoPrevio.title,
    description: opciones.contenidoPrevio.description,
    hashtags: opciones.contenidoPrevio.hashtags,
    status: 'pendiente',
    createdAt: new Date(),
  }

  // Almacén indexado por id para cada entidad.
  const videoPosts = new Map<number, VideoPostRow>([[videoPost.id, videoPost]])
  const platformContents = new Map<number, PlatformContentRow>([
    [platformContent.id, platformContent],
  ])

  let updateCount = 0

  const context = {
    user: { id: opciones.ownerId },
    entities: {
      VideoPost: {
        async findUnique({ where }: { where: { id: number } }) {
          const row = videoPosts.get(where.id)
          return row ? { ...row } : null
        },
      },
      PlatformContent: {
        async findUnique({ where }: { where: { id: number } }) {
          const row = platformContents.get(where.id)
          return row ? { ...row } : null
        },
        async update({
          where,
          data,
        }: {
          where: { id: number }
          data: Record<string, unknown>
        }) {
          updateCount++
          const row = platformContents.get(where.id)
          if (!row) throw new Error('registro inexistente')
          Object.assign(row, data)
          return { ...row }
        },
      },
    },
  }

  return {
    context: context as unknown as Parameters<typeof generatePlatformContent>[1],
    platformContentId: platformContent.id,
    // Lectores del estado persistido para las aserciones.
    leerContenido: () => ({ ...platformContents.get(platformContent.id)! }),
    contarRegistrosDePlataforma: (plat: string) =>
      [...platformContents.values()].filter((c) => c.platform === plat).length,
    getUpdateCount: () => updateCount,
  }
}

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const fieldValue = fc.string({ maxLength: 60 })

const contenido = fc.record({
  title: fieldValue,
  description: fieldValue,
  hashtags: fieldValue,
})

const plataforma = fc.constantFrom(...PLATAFORMAS)
const ownerId = fc.integer({ min: 1, max: 100000 })
const brief = fc.string({ maxLength: 40 })

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia — generatePlatformContent (propiedades)', () => {
  beforeEach(() => {
    generarMock.mockReset()
  })

  // Feature: publicador-videos-ia, Property 5: Generación produce y persiste
  // contenido completo. Cuando la IA devuelve {title,description,hashtags}, el
  // PlatformContent almacenado se actualiza a esos valores y los tres campos
  // están presentes.
  // Validates: Requirements 3.1, 3.3
  it('Property 5: persiste los tres campos devueltos por la IA', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerId,
        plataforma,
        brief,
        fc.webUrl(),
        contenido,
        async (uid, platform, b, videoUrl, generado) => {
          generarMock.mockReset()
          generarMock.mockResolvedValue(generado)

          const h = crearContexto({
            ownerId: uid,
            videoUrl,
            brief: b,
            platform,
            contenidoPrevio: { title: '', description: '', hashtags: '' },
          })

          const resultado = await generatePlatformContent(
            { platformContentId: h.platformContentId },
            h.context
          )

          // El valor devuelto refleja exactamente lo generado por la IA.
          expect(resultado.title).toBe(generado.title)
          expect(resultado.description).toBe(generado.description)
          expect(resultado.hashtags).toBe(generado.hashtags)

          // El registro PERSISTIDO se actualizó a esos valores.
          const almacenado = h.leerContenido()
          expect(almacenado.title).toBe(generado.title)
          expect(almacenado.description).toBe(generado.description)
          expect(almacenado.hashtags).toBe(generado.hashtags)

          // Los tres campos están presentes (son cadenas).
          expect(typeof almacenado.title).toBe('string')
          expect(typeof almacenado.description).toBe('string')
          expect(typeof almacenado.hashtags).toBe('string')
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 7: La regeneración reemplaza el
  // contenido previo. Partiendo de un PlatformContent con contenido previo,
  // regenerar reemplaza por completo title/description/hashtags con el nuevo
  // resultado de la IA, y sigue existiendo exactamente un registro para esa
  // plataforma.
  // Validates: Requirements 3.4
  it('Property 7: la regeneración reemplaza por completo el contenido previo', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerId,
        plataforma,
        brief,
        fc.webUrl(),
        contenido,
        contenido,
        async (uid, platform, b, videoUrl, previo, nuevo) => {
          generarMock.mockReset()
          generarMock.mockResolvedValue(nuevo)

          const h = crearContexto({
            ownerId: uid,
            videoUrl,
            brief: b,
            platform,
            contenidoPrevio: previo,
          })

          await generatePlatformContent(
            { platformContentId: h.platformContentId },
            h.context
          )

          const almacenado = h.leerContenido()

          // El contenido nuevo reemplaza por completo al previo.
          expect(almacenado.title).toBe(nuevo.title)
          expect(almacenado.description).toBe(nuevo.description)
          expect(almacenado.hashtags).toBe(nuevo.hashtags)

          // No queda mezcla con el contenido previo (salvo coincidencia real
          // del generador, en cuyo caso la igualdad con `nuevo` ya lo cubre).
          // Sigue existiendo exactamente un registro para la plataforma.
          expect(h.contarRegistrosDePlataforma(platform)).toBe(1)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 9: Conservación del contenido ante
  // error del proveedor. Cuando generateContentForPlatform lanza,
  // generatePlatformContent rechaza y el PlatformContent almacenado conserva su
  // title/description/hashtags previos sin cambios.
  // Validates: Requirements 3.6
  it('Property 9: ante error del proveedor, rechaza y conserva el contenido previo', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerId,
        plataforma,
        brief,
        fc.webUrl(),
        contenido,
        fc.string({ maxLength: 30 }),
        async (uid, platform, b, videoUrl, previo, mensajeError) => {
          generarMock.mockReset()
          generarMock.mockRejectedValue(new Error(mensajeError))

          const h = crearContexto({
            ownerId: uid,
            videoUrl,
            brief: b,
            platform,
            contenidoPrevio: previo,
          })

          // La acción debe rechazar (propagar el error del proveedor).
          await expect(
            generatePlatformContent(
              { platformContentId: h.platformContentId },
              h.context
            )
          ).rejects.toThrow()

          // El contenido persistido permanece sin cambios.
          const almacenado = h.leerContenido()
          expect(almacenado.title).toBe(previo.title)
          expect(almacenado.description).toBe(previo.description)
          expect(almacenado.hashtags).toBe(previo.hashtags)

          // No se realizó ninguna escritura.
          expect(h.getUpdateCount()).toBe(0)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
