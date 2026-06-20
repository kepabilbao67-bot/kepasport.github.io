// Prueba de integración del flujo completo del Publicador de Vídeos IA
// (Tarea 10.1): crear → generar → publicar.
//
// Feature: publicador-videos-ia
//
// A diferencia de las pruebas de propiedad por unidad, esta prueba ejercita las
// acciones REALES del backend (`createVideoPost`, `generatePlatformContent`,
// `publishPlatformContent` de `src/server/publisher/actions.ts`) encadenadas
// sobre un ÚNICO contexto de Wasp compartido con un Prisma en memoria. De este
// modo se verifica que las tres acciones cooperan correctamente: la creación
// inicializa los Contenido_Plataforma, la generación rellena el contenido y la
// publicación difunde la Carga_Publicacion y fija el Estado_Publicacion.
//
// Solo se mockean las DOS fronteras externas reales del sistema:
//   - La capa de IA (`./aiContent.js`): `generateContentForPlatform` devuelve un
//     contenido fijo, sin llamar a Claude.
//   - La red (`fetch` global vía `vi.stubGlobal`): responde OK a cada destino.
// Los destinos de salida se controlan con `OUTBOUND_WEBHOOK_URLS`. La lógica de
// negocio (validación, propiedad, transiciones de estado, fan-out real de
// `dispatch.ts`/`outbound.ts`) NO se mockea.
//
// **Validates: Requirements 2.1, 3.1, 5.1, 5.3**

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Contenido fijo devuelto por la capa de IA mockeada ---------------------
// Se declara con `vi.hoisted` para poder referenciarlo dentro de la fábrica de
// `vi.mock` (que se eleva al inicio del módulo).
const { CONTENIDO_IA } = vi.hoisted(() => ({
  CONTENIDO_IA: {
    title: 'Título generado por IA',
    description: 'Descripción generada por IA para la plataforma.',
    hashtags: '#ia #video #marketing',
  },
}))

// Mock de la capa de IA: la acción `generatePlatformContent` invoca
// `generateContentForPlatform`, que aquí devuelve siempre el contenido fijo.
vi.mock('./aiContent.js', () => ({
  generateContentForPlatform: vi.fn(async () => CONTENIDO_IA),
}))

// Se importan DESPUÉS del `vi.mock` para que `actions.ts` reciba el mock.
import {
  createVideoPost,
  generatePlatformContent,
  publishPlatformContent,
} from './actions.js'

// --- Contexto de Wasp compartido con Prisma en memoria ----------------------

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
 * Construye un único contexto de Wasp con un Prisma en memoria que implementa
 * `create`, `findUnique` y `update` para `VideoPost` y `PlatformContent`. El
 * mismo contexto se reutiliza a lo largo de todo el flujo para que el estado
 * persista entre las acciones (creación → generación → publicación).
 */
function crearContextoCompartido(userId: number) {
  const videoPosts = new Map<number, VideoPostRow>()
  const platformContents = new Map<number, PlatformContentRow>()
  let videoPostSeq = 1
  let platformContentSeq = 1

  const context = {
    user: { id: userId },
    entities: {
      VideoPost: {
        async create({ data }: { data: Record<string, unknown> }) {
          const row = {
            id: videoPostSeq++,
            createdAt: new Date(),
            ...(data as object),
          } as VideoPostRow
          videoPosts.set(row.id, row)
          return { ...row }
        },
        async findUnique({ where }: { where: { id: number } }) {
          const row = videoPosts.get(where.id)
          return row ? { ...row } : null
        },
        async update({
          where,
          data,
        }: {
          where: { id: number }
          data: Record<string, unknown>
        }) {
          const row = videoPosts.get(where.id)
          if (!row) throw new Error('VideoPost inexistente')
          Object.assign(row, data)
          return { ...row }
        },
      },
      PlatformContent: {
        async create({ data }: { data: Record<string, unknown> }) {
          const row = {
            id: platformContentSeq++,
            createdAt: new Date(),
            ...(data as object),
          } as PlatformContentRow
          platformContents.set(row.id, row)
          return { ...row }
        },
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
          const row = platformContents.get(where.id)
          if (!row) throw new Error('PlatformContent inexistente')
          Object.assign(row, data)
          return { ...row }
        },
      },
    },
  }

  return {
    context: context as any,
    leerContenido: (id: number) => ({ ...platformContents.get(id)! }),
  }
}

// --- Destinos de salida controlados -----------------------------------------

const DESTINOS = [
  'https://hooks.example.com/make/abc123',
  'https://n8n.example.com/webhook/def456',
]

describe('Feature: publicador-videos-ia — flujo de integración crear → generar → publicar', () => {
  let originalOutbound: string | undefined
  let originalZapier: string | undefined

  beforeEach(() => {
    // Guardar el entorno para restaurarlo después y partir de un estado limpio:
    // solo OUTBOUND_WEBHOOK_URLS controla los destinos.
    originalOutbound = process.env.OUTBOUND_WEBHOOK_URLS
    originalZapier = process.env.ZAPIER_WEBHOOK_URL
    process.env.OUTBOUND_WEBHOOK_URLS = DESTINOS.join(', ')
    delete process.env.ZAPIER_WEBHOOK_URL
  })

  afterEach(() => {
    // Restaurar el entorno para no filtrar estado entre pruebas.
    if (originalOutbound === undefined) delete process.env.OUTBOUND_WEBHOOK_URLS
    else process.env.OUTBOUND_WEBHOOK_URLS = originalOutbound
    if (originalZapier === undefined) delete process.env.ZAPIER_WEBHOOK_URL
    else process.env.ZAPIER_WEBHOOK_URL = originalZapier
    vi.unstubAllGlobals()
  })

  it('ejecuta el ciclo completo: crea la publicación, genera el contenido y lo publica como "enviado"', async () => {
    const OWNER_ID = 42
    const { context, leerContenido } = crearContextoCompartido(OWNER_ID)

    // `fetch` global mockeado: responde OK a todos los destinos (Req 5.3).
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    // --- Paso 1: createVideoPost (Req 2.1) ----------------------------------
    // Selecciona una plataforma automatizada (linkedin) y una manual (fiverr).
    const videoUrl = 'https://videos.example.com/clip-demo.mp4'
    const brief = 'Lanzamiento de un nuevo servicio de edición de vídeo con IA.'

    const creada = await createVideoPost(
      { videoUrl, brief, platforms: ['linkedin', 'fiverr'] },
      context
    )

    // Se creó la Publicacion_Video asociada al propietario.
    expect(creada.id).toBeGreaterThan(0)
    expect(creada.ownerId).toBe(OWNER_ID)
    expect(creada.videoUrl).toBe(videoUrl)

    // Se crearon exactamente 2 Contenido_Plataforma con los estados iniciales
    // correctos: linkedin (automatizada) → 'pendiente'; fiverr (manual) → 'manual'.
    expect(creada.contents).toHaveLength(2)
    const linkedinContent = creada.contents.find((c) => c.platform === 'linkedin')!
    const fiverrContent = creada.contents.find((c) => c.platform === 'fiverr')!
    expect(linkedinContent).toBeDefined()
    expect(fiverrContent).toBeDefined()
    expect(linkedinContent.status).toBe('pendiente')
    expect(fiverrContent.status).toBe('manual')

    // Antes de generar, el contenido está vacío.
    expect(linkedinContent.title).toBe('')
    expect(linkedinContent.description).toBe('')
    expect(linkedinContent.hashtags).toBe('')

    // --- Paso 2: generatePlatformContent (Req 3.1) --------------------------
    const generado = await generatePlatformContent(
      { platformContentId: linkedinContent.id },
      context
    )

    // El contenido de linkedin ahora tiene el título/descripción/hashtags
    // devueltos por la capa de IA mockeada.
    expect(generado.title).toBe(CONTENIDO_IA.title)
    expect(generado.description).toBe(CONTENIDO_IA.description)
    expect(generado.hashtags).toBe(CONTENIDO_IA.hashtags)

    // Persistido en el almacén compartido.
    const trasGenerar = leerContenido(linkedinContent.id)
    expect(trasGenerar.title).toBe(CONTENIDO_IA.title)
    expect(trasGenerar.description).toBe(CONTENIDO_IA.description)
    expect(trasGenerar.hashtags).toBe(CONTENIDO_IA.hashtags)

    // Aún no se ha publicado: no hubo llamadas de red durante la generación.
    expect(fetchMock).not.toHaveBeenCalled()

    // --- Paso 3: publishPlatformContent (Req 5.1, 5.3) ----------------------
    const publicado = await publishPlatformContent(
      { platformContentId: linkedinContent.id },
      context
    )

    // Todos los destinos respondieron OK → estado 'enviado' (Req 5.3).
    expect(publicado.status).toBe('enviado')
    expect(leerContenido(linkedinContent.id).status).toBe('enviado')

    // Se hizo POST exactamente una vez a cada destino configurado (Req 5.1).
    expect(fetchMock).toHaveBeenCalledTimes(DESTINOS.length)

    // El cuerpo enviado es la Carga_Publicacion con la URL del vídeo y el
    // contenido generado, y cada destino la recibió exactamente una vez.
    const cargaEsperada = {
      platform: 'linkedin',
      videoUrl,
      content: {
        title: CONTENIDO_IA.title,
        description: CONTENIDO_IA.description,
        hashtags: CONTENIDO_IA.hashtags,
      },
    }

    const urlsLlamadas = fetchMock.mock.calls.map(([url]) => url)
    expect(new Set(urlsLlamadas)).toEqual(new Set(DESTINOS))

    for (const destino of DESTINOS) {
      const llamadas = fetchMock.mock.calls.filter(([url]) => url === destino)
      expect(llamadas).toHaveLength(1)
      const [, init] = llamadas[0]
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(JSON.parse(init.body)).toEqual(cargaEsperada)
    }
  })
})
