// Prueba basada en propiedades de la capa de IA del Publicador de Vídeos IA.
//
// Feature: publicador-videos-ia, Property 8: Guarda de clave de API
// **Validates: Requirements 3.5, 7.3**
//
// Propiedad 8: para cualquier plataforma, brief y URL de vídeo, cuando la
// Clave_API (ANTHROPIC_API_KEY) está ausente o vacía, `generateContentForPlatform`
// rechaza con un error de configuración (HttpError 500) y el SDK de Anthropic
// NUNCA se construye ni se invoca.
//
// Notas de alcance (Requisitos 3.5, 7.3):
// - La guarda vive dentro de `streamCompletion` (`claudeProvider.ts`), que
//   comprueba `config.anthropicApiKey()` y lanza HttpError(500) ANTES de
//   construir el cliente de Anthropic. `generateContentForPlatform` ->
//   `generateText` consume ese async generator, por lo que la guarda se ejecuta
//   al comenzar la iteración y el rechazo se propaga.
// - `config.anthropicApiKey()` NO recorta espacios; la guarda es `if (!apiKey)`,
//   que considera "ausente" tanto `undefined` (variable no definida) como la
//   cadena vacía `''`. El espacio de entrada de esta propiedad cubre exactamente
//   esos dos casos.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

import { PLATAFORMAS } from './platforms'

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

import { generateContentForPlatform } from './aiContent'

describe('Feature: publicador-videos-ia, Property 8: Guarda de clave de API', () => {
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

  it('rechaza con error de configuración (500) y no construye ni invoca el SDK de Anthropic cuando la clave de API está ausente o vacía', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Clave de API "no configurada": ausente (undefined) o cadena vacía.
        fc.oneof(
          fc.constant<string | undefined>(undefined),
          fc.constant<string | undefined>('')
        ),
        // Cualquier plataforma del conjunto admitido.
        fc.constantFrom(...PLATAFORMAS),
        // Cualquier brief y URL de vídeo (incluidas cadenas vacías).
        fc.string(),
        fc.string(),
        async (apiKeyValue, platform, brief, videoUrl) => {
          // Estado de los espías limpio en cada ejecución de la propiedad.
          anthropicConstructor.mockClear()
          streamSpy.mockClear()

          // Configurar la ausencia de clave de API por ejecución.
          if (apiKeyValue === undefined) {
            delete process.env.ANTHROPIC_API_KEY
          } else {
            process.env.ANTHROPIC_API_KEY = apiKeyValue
          }

          // La generación debe rechazar con un error de configuración (500).
          await expect(
            generateContentForPlatform(brief, videoUrl, platform)
          ).rejects.toMatchObject({ statusCode: 500 })

          // El SDK de Anthropic nunca debe construirse ni invocarse.
          expect(anthropicConstructor).not.toHaveBeenCalled()
          expect(streamSpy).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })
})
