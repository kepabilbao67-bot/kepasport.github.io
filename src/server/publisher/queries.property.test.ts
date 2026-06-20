// Pruebas basadas en propiedades para las consultas del Publicador de Vídeos IA
// (Tarea 5.2).
//
// Feature: publicador-videos-ia
//
// Cubre las propiedades de diseño 1 y 10 con fast-check (mínimo 100 iteraciones
// por propiedad). Las pruebas ejercitan la lógica REAL de `getVideoPosts` (en
// `queries.ts`) contra un `context` de Wasp en memoria construido en este mismo
// archivo (no se reutilizan los ayudantes compartidos, que no necesitamos para
// estas consultas). El contexto reproduce el subconjunto de la API de Prisma
// usado por el código bajo prueba: `findMany` con `where.ownerId` y
// `orderBy.createdAt`.
//
// No se mockea la lógica de negocio: el conjunto esperado (filtrado por
// propietario y ordenado por fecha descendente) se calcula de forma
// independiente y se compara con el resultado de la consulta real.
//
// Validates: Requirements 1.3, 1.4, 4.1

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { getVideoPosts } from './queries.js'

const NUM_RUNS = 100

// --- Contexto en memoria (inline) -------------------------------------------

type VideoPostRow = {
  id: number
  ownerId: number
  videoUrl: string
  brief: string
  createdAt: Date
}

/**
 * Entidad VideoPost en memoria que honra el subconjunto de la API de Prisma
 * usado por `getVideoPosts`:
 *  - `where.ownerId`: igualdad escalar por propietario.
 *  - `orderBy.createdAt`: orden ascendente o descendente por fecha de creación.
 *
 * Si `getVideoPosts` omitiera el filtro por `ownerId` o no ordenara, el
 * resultado divergiría del conjunto esperado calculado de forma independiente y
 * la prueba fallaría.
 */
function makeVideoPostEntity(seed: VideoPostRow[]) {
  const rows = seed.map((r) => ({ ...r }))
  return {
    findMany: async ({
      where,
      orderBy,
    }: {
      where?: { ownerId?: number }
      orderBy?: { createdAt?: 'asc' | 'desc' }
    } = {}) => {
      let result = rows.filter(
        (r) => where?.ownerId === undefined || r.ownerId === where.ownerId
      )
      if (orderBy?.createdAt) {
        const dir = orderBy.createdAt
        result = [...result].sort((a, b) => {
          const av = a.createdAt.getTime()
          const bv = b.createdAt.getTime()
          if (av < bv) return dir === 'desc' ? 1 : -1
          if (av > bv) return dir === 'desc' ? -1 : 1
          return 0
        })
      }
      return result.map((r) => ({ ...r }))
    },
  }
}

function makeContext(posts: VideoPostRow[], viewerId: number) {
  return {
    user: { id: viewerId },
    entities: { VideoPost: makeVideoPostEntity(posts) },
  } as any
}

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const ownerId = fc.integer({ min: 1, max: 8 })

// Conjunto de Publicacion_Video: cada una con un propietario arbitrario y una
// marca de creación (`createdAt`) ÚNICA en todo el conjunto, de modo que el
// orden por `createdAt` descendente sea determinista y comparable de forma
// exacta (sin empates ambiguos).
const videoPostSet = fc
  .array(ownerId, { minLength: 0, maxLength: 20 })
  .chain((owners) =>
    fc
      .uniqueArray(fc.integer({ min: 0, max: 10_000_000 }), {
        minLength: owners.length,
        maxLength: owners.length,
      })
      .map((times) =>
        owners.map(
          (owner, i): VideoPostRow => ({
            id: i + 1,
            ownerId: owner,
            videoUrl: `https://video/${i}`,
            brief: `brief-${i}`,
            createdAt: new Date(times[i]),
          })
        )
      )
  )

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia — Consultas del publicador (propiedades)', () => {
  // Feature: publicador-videos-ia, Property 1: Aislamiento por propietario en el
  // listado — getVideoPosts devuelve exclusivamente las Publicacion_Video cuyo
  // `ownerId` coincide con el Usuario solicitante.
  // Validates: Requirements 1.3, 1.4
  it('Property 1: getVideoPosts devuelve exactamente las publicaciones del propietario solicitante', async () => {
    await fc.assert(
      fc.asyncProperty(videoPostSet, ownerId, async (posts, viewer) => {
        const context = makeContext(posts, viewer)
        const listed = await getVideoPosts(undefined, context)

        // Aislamiento: toda publicación devuelta pertenece al observador.
        expect(listed.every((p: any) => p.ownerId === viewer)).toBe(true)

        // Conjunto esperado calculado de forma independiente: exactamente las
        // publicaciones del observador (comparado como conjunto de ids).
        const expectedIds = posts
          .filter((p) => p.ownerId === viewer)
          .map((p) => p.id)
          .sort((a, b) => a - b)

        const actualIds = listed.map((p: any) => p.id).sort((a: number, b: number) => a - b)
        expect(actualIds).toEqual(expectedIds)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 10: Orden del listado por fecha
  // descendente — getVideoPosts devuelve las publicaciones del Usuario ordenadas
  // de forma no creciente por `createdAt`.
  // Validates: Requirements 4.1
  it('Property 10: getVideoPosts devuelve las publicaciones ordenadas por createdAt no creciente', async () => {
    await fc.assert(
      fc.asyncProperty(videoPostSet, ownerId, async (posts, viewer) => {
        const context = makeContext(posts, viewer)
        const listed = await getVideoPosts(undefined, context)

        // Orden esperado independiente: las del observador, ordenadas por
        // createdAt descendente (marcas únicas => orden determinista).
        const expectedIds = posts
          .filter((p) => p.ownerId === viewer)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((p) => p.id)

        expect(listed.map((p: any) => p.id)).toEqual(expectedIds)

        // Comprobación directa de la monotonía (no creciente) por `createdAt`.
        for (let i = 1; i < listed.length; i++) {
          const prev = new Date(listed[i - 1].createdAt).getTime()
          const curr = new Date(listed[i].createdAt).getTime()
          expect(prev).toBeGreaterThanOrEqual(curr)
        }
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
