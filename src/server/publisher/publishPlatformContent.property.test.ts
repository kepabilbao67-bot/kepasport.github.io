// Pruebas basadas en propiedades para las acciones del publicador a nivel de
// ACCIÓN (`actions.ts`): transiciones de estado, destinos vacíos y control de
// acceso del backend.
//
// Feature: publicador-videos-ia
//
// A diferencia de `dispatch.property.test.ts` (que ejercita el fan-out real de
// `publicarEnDestinos`), aquí el despachador se MOCKEA con `vi.mock('./dispatch.js')`
// para controlar de forma exacta el recuento `{ total, fallidos }` por iteración
// y observar la transición de Estado_Publicacion que decide `publishPlatformContent`.
// El contexto de Wasp se simula con un almacén Prisma en memoria (inline), sin
// tocar los ayudantes compartidos de `src/test/`.
//
// - Property 11: Transiciones de estado (nivel de acción) — Validates: Requirements 5.1, 5.3, 5.4
// - Property 13: Destinos vacíos → manual                  — Validates: Requirements 5.5
// - Property 2:  Control de acceso del backend             — Validates: Requirements 1.2, 1.5

import { describe, expect, it, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { HttpError } from 'wasp/server'

// El despachador es la frontera externa que esta prueba controla: se mockea el
// módulo completo para fijar el recuento { total, fallidos } por iteración.
vi.mock('./dispatch.js', () => ({
  publicarEnDestinos: vi.fn(),
}))

import { publicarEnDestinos } from './dispatch.js'
import {
  publishPlatformContent,
  generatePlatformContent,
  markManual,
} from './actions.js'

const mockedPublicar = vi.mocked(publicarEnDestinos)

const NUM_RUNS = 100
const ESTADOS = ['pendiente', 'enviado', 'error', 'manual'] as const

// --- Almacén Prisma en memoria (inline) -------------------------------------

interface VideoPostRec {
  id: number
  videoUrl: string
  fileRef: string | null
  brief: string
  ownerId: number
  createdAt: Date
}

interface PlatformContentRec {
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
 * Construye un contexto de Wasp simulado con un almacén en memoria y siembra
 * una VideoPost (de `ownerId`) con un PlatformContent (estado inicial dado).
 * Devuelve el contexto, el id del contenido y un captador del estado almacenado.
 */
function makeContext(opts: {
  user?: { id: number }
  ownerId: number
  platform?: string
  initialStatus?: string
}) {
  const videoPosts = new Map<number, VideoPostRec>()
  const platformContents = new Map<number, PlatformContentRec>()

  const videoPost: VideoPostRec = {
    id: 1,
    videoUrl: 'https://videos.example.com/clip.mp4',
    fileRef: null,
    brief: 'Un brief de prueba',
    ownerId: opts.ownerId,
    createdAt: new Date(),
  }
  videoPosts.set(videoPost.id, videoPost)

  const content: PlatformContentRec = {
    id: 1,
    videoPostId: videoPost.id,
    platform: opts.platform ?? 'linkedin',
    title: 'titulo previo',
    description: 'descripcion previa',
    hashtags: '#previo',
    status: opts.initialStatus ?? 'pendiente',
    createdAt: new Date(),
  }
  platformContents.set(content.id, content)

  const context = {
    user: opts.user,
    entities: {
      VideoPost: {
        async create({ data }: { data: Record<string, unknown> }) {
          const id = videoPosts.size + 1
          const rec = { id, createdAt: new Date(), ...(data as object) } as VideoPostRec
          videoPosts.set(id, rec)
          return rec
        },
        async findUnique({ where }: { where: { id: number } }) {
          return videoPosts.get(where.id) ?? null
        },
        async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
          const rec = { ...videoPosts.get(where.id)!, ...(data as object) } as VideoPostRec
          videoPosts.set(where.id, rec)
          return rec
        },
      },
      PlatformContent: {
        async create({ data }: { data: Record<string, unknown> }) {
          const id = platformContents.size + 1
          const rec = { id, createdAt: new Date(), ...(data as object) } as PlatformContentRec
          platformContents.set(id, rec)
          return rec
        },
        async findUnique({ where }: { where: { id: number } }) {
          return platformContents.get(where.id) ?? null
        },
        async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
          const rec = { ...platformContents.get(where.id)!, ...(data as object) } as PlatformContentRec
          platformContents.set(where.id, rec)
          return rec
        },
      },
    },
  }

  return {
    context: context as any,
    contentId: content.id,
    storedStatus: () => platformContents.get(content.id)!.status,
  }
}

// Generador acoplado: total > 0 con fallidos en [0..total].
const totalFallidosArb = fc
  .integer({ min: 1, max: 20 })
  .chain((total) =>
    fc.tuple(fc.constant(total), fc.integer({ min: 0, max: total }))
  )

beforeEach(() => {
  mockedPublicar.mockReset()
})

// ---------------------------------------------------------------------------
// Property 11: Transiciones de estado (nivel de acción)
// **Validates: Requirements 5.1, 5.3, 5.4**
// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia, Property 11 — transiciones de estado (nivel de acción)', () => {
  it('fija "enviado" cuando fallidos === 0 y "error" cuando fallidos > 0, para cualquier total > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        totalFallidosArb,
        fc.constantFrom(...ESTADOS),
        fc.integer({ min: 1, max: 1000 }),
        async ([total, fallidos], initialStatus, ownerId) => {
          mockedPublicar.mockResolvedValue({ total, fallidos })

          const { context, contentId, storedStatus } = makeContext({
            user: { id: ownerId },
            ownerId,
            initialStatus,
          })

          const result = await publishPlatformContent(
            { platformContentId: contentId },
            context
          )

          const esperado = fallidos === 0 ? 'enviado' : 'error'
          expect(result.status).toBe(esperado)
          expect(storedStatus()).toBe(esperado)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 13: Destinos vacíos → manual
// **Validates: Requirements 5.5**
// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia, Property 13 — destinos vacíos resultan en estado manual', () => {
  it('fija "manual" cuando publicarEnDestinos devuelve total === 0, sea cual sea el estado inicial', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ESTADOS),
        fc.integer({ min: 1, max: 1000 }),
        async (initialStatus, ownerId) => {
          // Sin destinos configurados: total === 0 (fallidos === 0 por definición).
          mockedPublicar.mockResolvedValue({ total: 0, fallidos: 0 })

          const { context, contentId, storedStatus } = makeContext({
            user: { id: ownerId },
            ownerId,
            initialStatus,
          })

          const result = await publishPlatformContent(
            { platformContentId: contentId },
            context
          )

          expect(result.status).toBe('manual')
          expect(storedStatus()).toBe('manual')
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 2: Control de acceso del backend
// **Validates: Requirements 1.2, 1.5**
// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia, Property 2 — control de acceso del backend', () => {
  // Las tres acciones que operan sobre un PlatformContent comparten la misma
  // verificación de sesión y propiedad. Se prueban todas con el mismo invariante.
  const acciones: Array<{
    nombre: string
    fn: (args: { platformContentId: number }, context: any) => Promise<unknown>
  }> = [
    { nombre: 'publishPlatformContent', fn: publishPlatformContent },
    { nombre: 'generatePlatformContent', fn: generatePlatformContent },
    { nombre: 'markManual', fn: markManual },
  ]

  it('sin sesión (context.user ausente) → HttpError 401 y el estado almacenado NO cambia', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...acciones.map((a) => a.nombre)),
        fc.constantFrom(...ESTADOS),
        fc.integer({ min: 1, max: 1000 }),
        async (nombreAccion, initialStatus, ownerId) => {
          // Si por algún camino se llamara, el despachador no debe alterar el flujo.
          mockedPublicar.mockResolvedValue({ total: 1, fallidos: 0 })

          const accion = acciones.find((a) => a.nombre === nombreAccion)!
          const { context, contentId, storedStatus } = makeContext({
            user: undefined, // sin sesión
            ownerId,
            initialStatus,
          })

          await expect(
            accion.fn({ platformContentId: contentId }, context)
          ).rejects.toMatchObject({ statusCode: 401 })

          // El estado almacenado permanece intacto.
          expect(storedStatus()).toBe(initialStatus)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  it('PlatformContent de OTRO Agente → HttpError 403 y el estado almacenado NO cambia', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...acciones.map((a) => a.nombre)),
        fc.constantFrom(...ESTADOS),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (nombreAccion, initialStatus, ownerId, callerSeed) => {
          // El llamante es un Agente distinto del propietario.
          const callerId = ownerId + callerSeed
          mockedPublicar.mockResolvedValue({ total: 1, fallidos: 0 })

          const accion = acciones.find((a) => a.nombre === nombreAccion)!
          const { context, contentId, storedStatus } = makeContext({
            user: { id: callerId }, // sesión válida pero NO propietaria
            ownerId,
            initialStatus,
          })

          await expect(
            accion.fn({ platformContentId: contentId }, context)
          ).rejects.toMatchObject({ statusCode: 403 })

          // El estado almacenado permanece intacto.
          expect(storedStatus()).toBe(initialStatus)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Caso positivo: un Agente propietario sí puede operar (no lanza 401/403).
  it('caso positivo: el Agente propietario opera sin error de acceso', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ESTADOS),
        fc.integer({ min: 1, max: 1000 }),
        async (initialStatus, ownerId) => {
          mockedPublicar.mockResolvedValue({ total: 1, fallidos: 0 })

          const { context, contentId } = makeContext({
            user: { id: ownerId }, // propietario
            ownerId,
            initialStatus,
          })

          // markManual es la operación más simple (sin generación ni despacho):
          // basta con que no lance por control de acceso.
          const result = (await markManual(
            { platformContentId: contentId },
            context
          )) as PlatformContentRec
          expect(result.status).toBe('manual')
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})

// Referencia explícita para evitar avisos de import sin uso si cambia el linter.
void HttpError
