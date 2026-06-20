// Pruebas basadas en propiedades para `createVideoPost` (Tarea 6.2).
//
// Feature: publicador-videos-ia
//
// Cubre las propiedades de diseño 4, 14 y 3 (a nivel de acción) con fast-check
// (mínimo 100 iteraciones por propiedad). Las pruebas ejercitan la lógica REAL
// de `actions.ts` contra un contexto Wasp en memoria construido en este mismo
// archivo (delegados Prisma mínimos para `VideoPost` y `PlatformContent` con
// identificadores autoincrementales y un accesor `_rows()`). No se mockea la
// lógica de negocio ni se modifican los ayudantes compartidos de `src/test/`.
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 6.3, 7.1

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { HttpError } from 'wasp/server'

import { createVideoPost } from './actions.js'
import { PLATAFORMAS, esManual, type Platform } from './platforms.js'

const NUM_RUNS = 100

// --- Contexto Wasp en memoria (delegado Prisma mínimo) ----------------------

/**
 * Crea un delegado Prisma en memoria que solo implementa `create`, asignando
 * identificadores autoincrementales y una marca `createdAt`. Expone `_rows()`
 * para inspeccionar las filas persistidas en las aserciones.
 */
function createDelegate<T extends Record<string, unknown>>() {
  const rows: Array<T & { id: number; createdAt: Date }> = []
  let nextId = 1
  return {
    async create({ data }: { data: Record<string, unknown> }) {
      const row = { ...(data as T), id: nextId++, createdAt: new Date() }
      rows.push(row)
      return row
    },
    _rows() {
      return rows
    },
  }
}

/** Construye un contexto del publicador con un usuario opcional. */
function createPublisherContext(user?: { id: number }) {
  const VideoPost = createDelegate<{
    videoUrl: string
    fileRef: string | null
    brief: string
    ownerId: number
  }>()
  const PlatformContent = createDelegate<{
    videoPostId: number
    platform: string
    title: string
    description: string
    hashtags: string
    status: string
  }>()
  return {
    context: { user, entities: { VideoPost, PlatformContent } } as any,
    videoPosts: VideoPost,
    platformContents: PlatformContent,
  }
}

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const agentId = fc.integer({ min: 1, max: 1_000_000 })

// URL de vídeo no vacía tras recortar espacios (entrada válida).
const validVideoUrl = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)

// Subconjunto NO vacío y sin duplicados de las plataformas admitidas.
const validPlatforms = fc
  .subarray(PLATAFORMAS as Platform[], { minLength: 1 })

// Subconjunto que SIEMPRE incluye al menos una plataforma manual (fiverr).
const platformsWithManual = fc
  .subarray(PLATAFORMAS.filter((p) => p !== 'fiverr') as Platform[])
  .map((rest) => ['fiverr', ...rest] as Platform[])

const brief = fc.string({ maxLength: 40 })
const optionalFileRef = fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
  nil: undefined,
})

// Cadenas en blanco (vacías o solo espacios) para una URL inválida.
const blank = fc.constantFrom('', ' ', '   ', '\t', '\n', '  \t ')

// Entrada inválida: URL en blanco (con plataformas válidas) o sin plataformas.
const invalidInput = fc.oneof(
  fc.record({
    videoUrl: blank,
    fileRef: optionalFileRef,
    brief,
    platforms: validPlatforms,
  }),
  fc.record({
    videoUrl: validVideoUrl,
    fileRef: optionalFileRef,
    brief,
    platforms: fc.constant([] as Platform[]),
  })
)

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia — createVideoPost (propiedades)', () => {
  // Property 4: Inicialización de contenidos por plataforma
  // Validates: Requirements 2.1, 2.2, 2.5
  it('Property 4: persiste un PlatformContent por plataforma, conserva fileRef y las automatizadas quedan pendientes', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        validVideoUrl,
        brief,
        validPlatforms,
        optionalFileRef,
        async (ownerId, videoUrl, briefText, platforms, fileRef) => {
          const { context, videoPosts, platformContents } =
            createPublisherContext({ id: ownerId })

          const result = await createVideoPost(
            { videoUrl, fileRef, brief: briefText, platforms },
            context
          )

          // Exactamente una Publicacion_Video, asociada al propietario.
          expect(videoPosts._rows()).toHaveLength(1)
          expect(videoPosts._rows()[0].ownerId).toBe(ownerId)

          // Conserva fileRef cuando se proporciona (null en caso contrario).
          expect(videoPosts._rows()[0].fileRef).toBe(fileRef ?? null)

          // Exactamente un Contenido_Plataforma por plataforma seleccionada.
          const rows = platformContents._rows()
          expect(rows).toHaveLength(platforms.length)
          const persistedPlatforms = rows.map((r) => r.platform).sort()
          expect(persistedPlatforms).toEqual([...platforms].sort())

          // Cada plataforma automatizada arranca en estado `pendiente`.
          for (const row of rows) {
            if (!esManual(row.platform as Platform)) {
              expect(row.status).toBe('pendiente')
            }
          }

          // El resultado devuelto refleja los contenidos creados.
          expect(result.contents).toHaveLength(platforms.length)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 14: Las plataformas manuales quedan en estado manual
  // Validates: Requirements 6.3
  it('Property 14: cualquier plataforma manual (fiverr) seleccionada queda con estado `manual`', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        validVideoUrl,
        brief,
        platformsWithManual,
        async (ownerId, videoUrl, briefText, platforms) => {
          const { context, platformContents } = createPublisherContext({
            id: ownerId,
          })

          await createVideoPost(
            { videoUrl, brief: briefText, platforms },
            context
          )

          // Cada Contenido_Plataforma de una plataforma manual queda en `manual`.
          for (const row of platformContents._rows()) {
            if (esManual(row.platform as Platform)) {
              expect(row.status).toBe('manual')
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 3: Validación de creación (nivel de acción)
  // Validates: Requirements 2.3, 2.4, 7.1
  it('Property 3: URL vacía/espacios o plataformas vacías → HttpError y no persiste nada', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, invalidInput, async (ownerId, input) => {
        const { context, videoPosts, platformContents } =
          createPublisherContext({ id: ownerId })

        await expect(
          createVideoPost(input as any, context)
        ).rejects.toBeInstanceOf(HttpError)

        // No se persistió ninguna Publicacion_Video ni Contenido_Plataforma.
        expect(videoPosts._rows()).toHaveLength(0)
        expect(platformContents._rows()).toHaveLength(0)
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
