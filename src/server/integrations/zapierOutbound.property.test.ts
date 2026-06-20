// Pruebas basadas en propiedades para el webhook de salida de Zapier (Tarea 12.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre las propiedades de diseño 25 y 26 con fast-check (mínimo 100 iteraciones
// por propiedad). Las pruebas ejercitan la lógica REAL de `notificarCliente`
// (`zapierOutbound.ts`) y `serializeClient`/`config` reales. El único punto que
// se mockea es el `fetch` global, que es exactamente la frontera externa (la
// red) que estas propiedades deben observar:
//   - Property 25 verifica que se envía EXACTAMENTE una solicitud cuyo cuerpo
//     contiene la representación del cliente cuando hay URL configurada.
//   - Property 26 verifica la resiliencia: la operación termina sin lanzar tanto
//     si la URL está ausente (envío omitido) como si el envío falla.
//
// **Validates: Requirements 10.1, 10.3, 10.4**

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

import { notificarCliente } from './zapierOutbound.js'
import { serializeClient } from '../chat/context.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// Campo de texto opcional: cadena arbitraria o `null` (semántica de Prisma para
// columnas anulables). Se evita `undefined` porque `JSON.stringify` lo descarta
// y no sobreviviría al round-trip que comprueban las aserciones del cuerpo.
const optionalText = fc.option(fc.string({ maxLength: 40 }), { nil: null })

// Cliente persistido arbitrario. Incluye tanto los campos serializables como
// algunos campos internos (ownerId, fechas) para reflejar la entidad real; el
// cuerpo del webhook solo debe contener la representación de `serializeClient`.
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

// URL de webhook "configurada" (no vacía).
const urlArb = fc
  .webUrl()
  .filter((u) => u.length > 0)

// URL "no configurada": ausente (undefined) o cadena vacía. `config.zapierWebhookUrl`
// devuelve el valor crudo de la variable de entorno, y `notificarCliente` usa la
// guarda `if (!url)`, que trata ambos casos como "sin configurar".
const unsetUrlArb = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant<string | undefined>('')
)

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — webhook de salida de Zapier (propiedades)', () => {
  let originalUrl: string | undefined

  beforeEach(() => {
    originalUrl = process.env.ZAPIER_WEBHOOK_URL
  })

  afterEach(() => {
    // Restaurar el entorno para no filtrar estado entre pruebas.
    if (originalUrl === undefined) {
      delete process.env.ZAPIER_WEBHOOK_URL
    } else {
      process.env.ZAPIER_WEBHOOK_URL = originalUrl
    }
    vi.unstubAllGlobals()
  })

  // Property 25: Envío del webhook de salida al crear o actualizar
  // Validates: Requirements 10.1
  it('Property 25: con una URL configurada se envía exactamente una solicitud cuyo cuerpo contiene la representación del cliente', async () => {
    await fc.assert(
      fc.asyncProperty(urlArb, clientArb, eventArb, async (url, client, event) => {
        // `fetch` mockeado: resuelve como una respuesta correcta.
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
        vi.stubGlobal('fetch', fetchMock)

        process.env.ZAPIER_WEBHOOK_URL = url

        await notificarCliente(client as any, event)

        // Exactamente una solicitud HTTP.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // Se envía a la URL configurada, vía POST.
        const [calledUrl, init] = fetchMock.mock.calls[0]
        expect(calledUrl).toBe(url)
        expect(init.method).toBe('POST')

        // El cuerpo contiene la representación del cliente (Requisito 10.1).
        const body = JSON.parse(init.body)
        expect(body.event).toBe(event)
        expect(body.client).toEqual(serializeClient(client as any))
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 26 (caso A): la URL está ausente → se omite el envío y no se lanza.
  // Validates: Requirements 10.3
  it('Property 26 (URL ausente): no se envía ninguna solicitud y la operación no lanza', async () => {
    await fc.assert(
      fc.asyncProperty(unsetUrlArb, clientArb, eventArb, async (url, client, event) => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
        vi.stubGlobal('fetch', fetchMock)

        if (url === undefined) {
          delete process.env.ZAPIER_WEBHOOK_URL
        } else {
          process.env.ZAPIER_WEBHOOK_URL = url
        }

        // No debe lanzar (resuelve sin error).
        await expect(notificarCliente(client as any, event)).resolves.toBeUndefined()

        // El envío se omitió: `fetch` nunca se invocó (Requisito 10.3).
        expect(fetchMock).not.toHaveBeenCalled()
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 26 (caso B): el envío falla → se registra y la operación no lanza.
  // Validates: Requirements 10.4
  it('Property 26 (envío fallido): el fallo del webhook se captura y la operación no lanza', async () => {
    await fc.assert(
      fc.asyncProperty(urlArb, clientArb, eventArb, async (url, client, event) => {
        // `fetch` rechaza: simula un fallo de red o del webhook.
        const fetchMock = vi.fn().mockRejectedValue(new Error('fallo de red simulado'))
        vi.stubGlobal('fetch', fetchMock)

        // Silenciar el log de error esperado para no contaminar la salida.
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        process.env.ZAPIER_WEBHOOK_URL = url

        // A pesar del rechazo de `fetch`, `notificarCliente` NUNCA lanza.
        await expect(notificarCliente(client as any, event)).resolves.toBeUndefined()

        // Se intentó el envío exactamente una vez y el fallo se registró.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(errorSpy).toHaveBeenCalled()

        errorSpy.mockRestore()
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
