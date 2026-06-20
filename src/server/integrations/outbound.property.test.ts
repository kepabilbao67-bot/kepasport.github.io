// Pruebas basadas en propiedades para la capa de automatización de salida genérica.
//
// Feature: claude-chatbot-assistant
//
// Ejercitan la lógica REAL de `notificarClienteEvento` (`outbound.ts`) junto con
// `serializeClient`/`config` reales. El único punto mockeado es el `fetch`
// global, que es la frontera externa (la red) que estas propiedades observan.
//
// Propiedades verificadas (mínimo 100 iteraciones cada una):
//   (a) Fan-out: con N destinos configurados se hace POST exactamente una vez a
//       CADA destino, con el cuerpo serializado del Cliente.
//   (b) Resiliencia: un destino que falla no impide los envíos a los demás y la
//       función nunca lanza.
//   (c) Sin destinos configurados → no se invoca `fetch` y no se lanza.
//   (d) Compatibilidad hacia atrás: con solo `ZAPIER_WEBHOOK_URL` configurada se
//       notifica esa URL.
//
// **Validates: Requirements 10.1, 10.3, 10.4**

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

import { notificarClienteEvento } from './outbound.js'
import { serializeClient } from '../chat/context.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const optionalText = fc.option(fc.string({ maxLength: 40 }), { nil: null })

const clientArb = fc.record({
  id: fc.integer({ min: 1, max: 1_000_000 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  email: fc.string({ minLength: 1, maxLength: 40 }),
  phone: optionalText,
  company: optionalText,
  status: optionalText,
  notes: optionalText,
  ownerId: fc.integer({ min: 1, max: 1_000_000 }),
  lastActivityAt: fc.date({ min: new Date(0), max: new Date(4_000_000_000_000) }),
  createdAt: fc.date({ min: new Date(0), max: new Date(4_000_000_000_000) }),
})

const eventArb = fc.constantFrom<'created' | 'updated'>('created', 'updated')

// Lista de URLs de destino DISTINTAS (no vacías). Se exige unicidad para poder
// afirmar "exactamente una solicitud por destino": la capa deduplica, así que
// duplicados colapsarían y harían ambigua la cuenta. Se excluyen URLs que
// contengan los separadores de la lista (comas o espacios), ya que no forman
// parte del espacio de entrada válido para `OUTBOUND_WEBHOOK_URLS`.
const urlArb = fc.webUrl().filter((u) => u.length > 0 && !/[\s,]/.test(u))

const distinctUrlsArb = fc.uniqueArray(urlArb, {
  minLength: 1,
  maxLength: 5,
  selector: (u) => u,
})

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — automatización de salida genérica (propiedades)', () => {
  let originalOutbound: string | undefined
  let originalZapier: string | undefined

  beforeEach(() => {
    originalOutbound = process.env.OUTBOUND_WEBHOOK_URLS
    originalZapier = process.env.ZAPIER_WEBHOOK_URL
    // Partir de un entorno limpio en cada caso.
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

  // (a) Fan-out a todos los destinos exactamente una vez con el cuerpo serializado.
  // Validates: Requirements 10.1
  it('(a) difunde a TODOS los destinos configurados exactamente una vez cada uno con el cuerpo del cliente', async () => {
    await fc.assert(
      fc.asyncProperty(distinctUrlsArb, clientArb, eventArb, async (urls, client, event) => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
        vi.stubGlobal('fetch', fetchMock)

        // Mezclar separadores de coma y espacio para ejercitar el parseo.
        process.env.OUTBOUND_WEBHOOK_URLS = urls.join(urls.length % 2 === 0 ? ', ' : ' ')

        await notificarClienteEvento(client as any, event)

        // Una solicitud por destino, ni más ni menos.
        expect(fetchMock).toHaveBeenCalledTimes(urls.length)

        // Cada URL recibió exactamente un POST con el cuerpo serializado correcto.
        const expectedBody = JSON.stringify({ event, client: serializeClient(client as any) })
        const calledUrls = fetchMock.mock.calls.map(([u]) => u)
        for (const url of urls) {
          const calls = fetchMock.mock.calls.filter(([u]) => u === url)
          expect(calls).toHaveLength(1)
          const [, init] = calls[0]
          expect(init.method).toBe('POST')
          expect(init.body).toBe(expectedBody)
        }
        // No se contacta ningún destino inesperado.
        expect(new Set(calledUrls)).toEqual(new Set(urls))
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // (b) Un destino que falla no impide los demás y la función nunca lanza.
  // Validates: Requirements 10.4
  it('(b) un destino que falla no impide los envíos a los demás y nunca lanza', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUrlsArb,
        clientArb,
        eventArb,
        fc.nat(),
        async (urls, client, event, failSeed) => {
          // Elegir un índice de destino que fallará.
          const failIdx = failSeed % urls.length
          const failingUrl = urls[failIdx]

          const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url === failingUrl) return Promise.reject(new Error('fallo de red simulado'))
            return Promise.resolve({ ok: true, status: 200 })
          })
          vi.stubGlobal('fetch', fetchMock)

          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

          process.env.OUTBOUND_WEBHOOK_URLS = urls.join(',')

          // Nunca lanza pese al rechazo de uno de los destinos.
          await expect(notificarClienteEvento(client as any, event)).resolves.toBeUndefined()

          // Se intentaron TODOS los destinos (el fallo no cortó el fan-out).
          expect(fetchMock).toHaveBeenCalledTimes(urls.length)
          const calledUrls = new Set(fetchMock.mock.calls.map(([u]) => u))
          expect(calledUrls).toEqual(new Set(urls))
          // El fallo se registró.
          expect(errorSpy).toHaveBeenCalled()

          errorSpy.mockRestore()
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // (c) Sin destinos configurados → no se invoca fetch y no se lanza.
  // Validates: Requirements 10.3
  it('(c) sin destinos configurados no se invoca fetch y no se lanza', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Tres formas de "sin destinos": ambas variables ausentes, o vacías/solo
        // separadores que no producen ninguna URL.
        fc.constantFrom<string | undefined>(undefined, '', '   ', ' , , ', '\n\t'),
        clientArb,
        eventArb,
        async (outboundValue, client, event) => {
          const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
          vi.stubGlobal('fetch', fetchMock)

          if (outboundValue === undefined) delete process.env.OUTBOUND_WEBHOOK_URLS
          else process.env.OUTBOUND_WEBHOOK_URLS = outboundValue
          // ZAPIER_WEBHOOK_URL queda sin configurar (limpiada en beforeEach).

          await expect(notificarClienteEvento(client as any, event)).resolves.toBeUndefined()

          expect(fetchMock).not.toHaveBeenCalled()
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // (d) Compatibilidad hacia atrás: solo ZAPIER_WEBHOOK_URL configurada notifica esa URL.
  // Validates: Requirements 10.1
  it('(d) con solo ZAPIER_WEBHOOK_URL configurada se notifica esa URL exactamente una vez', async () => {
    await fc.assert(
      fc.asyncProperty(
        urlArb,
        clientArb,
        eventArb,
        async (zapierUrl, client, event) => {
          const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
          vi.stubGlobal('fetch', fetchMock)

          // Solo el destino heredado; la lista genérica queda sin configurar.
          delete process.env.OUTBOUND_WEBHOOK_URLS
          process.env.ZAPIER_WEBHOOK_URL = zapierUrl

          await notificarClienteEvento(client as any, event)

          expect(fetchMock).toHaveBeenCalledTimes(1)
          const [calledUrl, init] = fetchMock.mock.calls[0]
          expect(calledUrl).toBe(zapierUrl)
          expect(init.method).toBe('POST')
          const body = JSON.parse(init.body)
          expect(body.event).toBe(event)
          expect(body.client).toEqual(serializeClient(client as any))
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
