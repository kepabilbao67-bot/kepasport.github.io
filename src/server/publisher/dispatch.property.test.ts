// Pruebas basadas en propiedades para el despachador de salida del publicador.
//
// Feature: publicador-videos-ia, Property 11
//
// Ejercitan la lógica REAL de `publicarEnDestinos` (`dispatch.ts`) junto con
// `resolverDestinos`/`config` reales. El único punto mockeado es el `fetch`
// global, que es la frontera externa (la red) que esta propiedad observa.
//
// Property 11 (nivel de despachador): Fan-out de publicación y resiliencia.
// Para cualquier conjunto no vacío de URLs de destino DISTINTAS configuradas vía
// `OUTBOUND_WEBHOOK_URLS`, `publicarEnDestinos` hace POST exactamente una vez a
// CADA destino con el cuerpo JSON de la Carga_Publicacion. Cuando todas las
// respuestas son satisfactorias → `fallidos === 0`. Cuando se fuerza el fallo de
// un subconjunto arbitrario (rechazo o respuesta no satisfactoria) → todos los
// destinos se intentan igualmente (`total` llamadas === número de destinos) y
// `fallidos` === tamaño del subconjunto que falla.
//
// **Validates: Requirements 5.1, 5.3, 5.4**

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

import { publicarEnDestinos, type CargaPublicacion } from './dispatch.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// URLs de destino DISTINTAS (no vacías). Se exige unicidad para poder afirmar
// "exactamente una solicitud por destino": la capa deduplica, así que los
// duplicados colapsarían y harían ambigua la cuenta. Se excluyen URLs que
// contengan los separadores de la lista (comas o espacios), ya que no forman
// parte del espacio de entrada válido para `OUTBOUND_WEBHOOK_URLS`.
const urlArb = fc.webUrl().filter((u) => u.length > 0 && !/[\s,]/.test(u))

const distinctUrlsArb = fc.uniqueArray(urlArb, {
  minLength: 1,
  maxLength: 6,
  selector: (u) => u,
})

// Carga_Publicacion arbitraria pero bien formada (Req 5.1).
const cargaArb: fc.Arbitrary<CargaPublicacion> = fc.record({
  platform: fc.constantFrom('linkedin', 'instagram', 'youtube', 'x', 'tiktok'),
  videoUrl: fc.webUrl(),
  content: fc.record({
    title: fc.string({ maxLength: 60 }),
    description: fc.string({ maxLength: 120 }),
    hashtags: fc.string({ maxLength: 40 }),
  }),
})

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia, Property 11 — fan-out y resiliencia del despachador', () => {
  let originalOutbound: string | undefined
  let originalZapier: string | undefined

  beforeEach(() => {
    originalOutbound = process.env.OUTBOUND_WEBHOOK_URLS
    originalZapier = process.env.ZAPIER_WEBHOOK_URL
    // Partir de un entorno limpio en cada caso: solo OUTBOUND_WEBHOOK_URLS
    // controla los destinos; ZAPIER_WEBHOOK_URL no debe añadir destinos extra.
    delete process.env.OUTBOUND_WEBHOOK_URLS
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

  // (a) Todos los destinos responden OK → POST exactamente una vez a cada uno
  //     con el cuerpo JSON de la carga, y fallidos === 0.
  // Validates: Requirements 5.1, 5.3
  it('(a) hace POST exactamente una vez a cada destino con el cuerpo de la carga y fallidos === 0 cuando todo va bien', async () => {
    await fc.assert(
      fc.asyncProperty(distinctUrlsArb, cargaArb, async (urls, carga) => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
        vi.stubGlobal('fetch', fetchMock)

        // Mezclar separadores de coma y espacio para ejercitar el parseo.
        process.env.OUTBOUND_WEBHOOK_URLS = urls.join(urls.length % 2 === 0 ? ', ' : ' ')

        const resultado = await publicarEnDestinos(carga)

        // Una solicitud por destino, ni más ni menos (Req 5.1).
        expect(fetchMock).toHaveBeenCalledTimes(urls.length)
        expect(resultado.total).toBe(urls.length)
        // Todos OK → sin fallos (Req 5.3).
        expect(resultado.fallidos).toBe(0)

        // Cada URL recibió exactamente un POST con el cuerpo JSON de la carga.
        const expectedBody = JSON.stringify(carga)
        const calledUrls = fetchMock.mock.calls.map(([u]) => u)
        for (const url of urls) {
          const calls = fetchMock.mock.calls.filter(([u]) => u === url)
          expect(calls).toHaveLength(1)
          const [, init] = calls[0]
          expect(init.method).toBe('POST')
          expect(init.body).toBe(expectedBody)
          expect(JSON.parse(init.body)).toEqual(carga)
        }
        // No se contacta ningún destino inesperado.
        expect(new Set(calledUrls)).toEqual(new Set(urls))
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // (b) Un subconjunto arbitrario de destinos falla (rechazo o respuesta no ok):
  //     TODOS los destinos se intentan igualmente y fallidos === tamaño del
  //     subconjunto que falla (resiliencia con aislamiento por destino).
  // Validates: Requirements 5.1, 5.4
  it('(b) ante un subconjunto que falla, intenta todos los destinos y fallidos === tamaño del subconjunto que falla', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUrlsArb,
        cargaArb,
        // Para cada destino: 'ok' = respuesta satisfactoria, 'reject' = excepción
        // de red, 'notok' = respuesta HTTP no satisfactoria. Las dos últimas
        // cuentan como fallo.
        fc.array(fc.constantFrom('ok', 'reject', 'notok'), { minLength: 6, maxLength: 6 }),
        async (urls, carga, outcomeSeed) => {
          // Asignar un resultado a cada URL (por índice).
          const outcomeFor = new Map<string, 'ok' | 'reject' | 'notok'>()
          urls.forEach((url, i) => outcomeFor.set(url, outcomeSeed[i] as 'ok' | 'reject' | 'notok'))

          const failingUrls = urls.filter((u) => outcomeFor.get(u) !== 'ok')

          const fetchMock = vi.fn().mockImplementation((url: string) => {
            const outcome = outcomeFor.get(url)
            if (outcome === 'reject') return Promise.reject(new Error('fallo de red simulado'))
            if (outcome === 'notok') return Promise.resolve({ ok: false, status: 500 })
            return Promise.resolve({ ok: true, status: 200 })
          })
          vi.stubGlobal('fetch', fetchMock)

          // Silenciar el registro de errores esperado por destinos que rechazan.
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

          process.env.OUTBOUND_WEBHOOK_URLS = urls.join(',')

          // Nunca lanza pese a rechazos/respuestas no satisfactorias.
          const resultado = await publicarEnDestinos(carga)

          // Se intentaron TODOS los destinos (el fallo no cortó el fan-out, Req 5.4).
          expect(fetchMock).toHaveBeenCalledTimes(urls.length)
          expect(resultado.total).toBe(urls.length)
          const calledUrls = new Set(fetchMock.mock.calls.map(([u]) => u))
          expect(calledUrls).toEqual(new Set(urls))

          // fallidos === tamaño del subconjunto que falla.
          expect(resultado.fallidos).toBe(failingUrls.length)

          errorSpy.mockRestore()
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
