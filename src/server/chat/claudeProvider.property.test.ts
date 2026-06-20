// Prueba basada en propiedades del Proveedor_Claude.
//
// Feature: claude-chatbot-assistant, Property 23: Guarda por ausencia de clave de API
// **Validates: Requirements 8.5**
//
// Propiedad 23: para toda solicitud iniciada cuando la clave de API NO está
// configurada, `streamCompletion` debe rechazar con un error de configuración
// (HttpError 500) y NO debe invocarse al proveedor de Anthropic.
//
// Notas de alcance (Requisito 8.5):
// - El criterio de aceptación 8.5 habla de que la clave "falta" (ausente). La
//   guarda implementada en `claudeProvider.ts` es `if (!apiKey)`, que considera
//   "ausente" tanto el valor `undefined` (variable no definida) como la cadena
//   vacía `''`. El generador cubre exactamente estos casos.
// - A diferencia de `config.claudeModel()` (que recorta espacios y trata el
//   blanco como "sin configurar"), `config.anthropicApiKey()` NO recorta: una
//   clave compuesta solo por espacios es, por diseño, una clave "presente" (si
//   bien inválida) y su manejo corresponde al error del proveedor (Requisito 9),
//   no a esta guarda. Por eso el blanco se excluye deliberadamente del espacio
//   de entrada de esta propiedad.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

// Espías creados con `vi.hoisted` para poder referenciarlos dentro de la
// fábrica de `vi.mock` (que se eleva al inicio del módulo).
const { anthropicConstructor, streamSpy } = vi.hoisted(() => ({
  anthropicConstructor: vi.fn(),
  streamSpy: vi.fn(),
}))

// Mock del SDK `@anthropic-ai/sdk`: el constructor registra cada invocación y
// `messages.stream` es un espía. Si la guarda funciona, NINGUNO debe llamarse
// cuando la clave de API falta.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamSpy }
    constructor(...args: unknown[]) {
      anthropicConstructor(...args)
    }
  },
}))

import { streamCompletion, type ChatMessage } from './claudeProvider'

describe('Feature: claude-chatbot-assistant, Property 23: Guarda por ausencia de clave de API', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    // Restaurar el entorno para no filtrar estado entre pruebas.
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = original
    }
  })

  it('lanza un error de configuración (500) y no invoca al proveedor cuando la clave de API no está configurada', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Clave de API "no configurada": ausente (undefined) o cadena vacía.
        fc.oneof(
          fc.constant<string | undefined>(undefined),
          fc.constant<string | undefined>('')
        ),
        // Una solicitud arbitraria: cualquier historial de mensajes válido,
        // incluido el vacío, para reforzar "para toda solicitud iniciada".
        fc.array(
          fc.record({
            role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
            content: fc.string(),
          }),
          { maxLength: 10 }
        ),
        async (apiKeyValue, messages) => {
          // Estado de los espías limpio en cada ejecución de la propiedad.
          anthropicConstructor.mockClear()
          streamSpy.mockClear()

          // Configurar la ausencia de clave de API.
          if (apiKeyValue === undefined) {
            delete process.env.ANTHROPIC_API_KEY
          } else {
            process.env.ANTHROPIC_API_KEY = apiKeyValue
          }

          // `streamCompletion` es un async generator: la guarda se ejecuta al
          // comenzar a iterar (primer `.next()`), no al construirlo.
          const gen = streamCompletion(messages as ChatMessage[])

          await expect(gen.next()).rejects.toMatchObject({ statusCode: 500 })

          // El proveedor de Anthropic nunca debe construirse ni invocarse.
          expect(anthropicConstructor).not.toHaveBeenCalled()
          expect(streamSpy).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })
})
