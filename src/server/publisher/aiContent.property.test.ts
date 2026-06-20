// Pruebas basadas en propiedades para la capa de IA del Publicador (Tarea 2.2).
//
// Feature: publicador-videos-ia
//
// Cubre la Property 5 a nivel de PARSEO: `parseContenido` interpreta la salida
// del Proveedor_Claude y SIEMPRE devuelve los tres campos (`title`,
// `description`, `hashtags`) como cadenas (forma estable), y para JSON
// bien formado devuelve los valores exactos. Opcionalmente verifica
// `generateContentForPlatform` mockeando `streamCompletion` para emitir un JSON
// controlado, comprobando que devuelve los tres campos.
//
// La ÚNICA dependencia mockeada es `streamCompletion` del Proveedor_Claude (para
// no llamar a Anthropic). La lógica de parseo/ensamblado NO se mockea.
//
// Validates: Requirements 3.1, 3.3

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

import { PLATAFORMAS } from './platforms.js'

const NUM_RUNS = 100

// Espía del Proveedor_Claude creado con `vi.hoisted` para poder referenciarlo
// dentro de la fábrica de `vi.mock` (que se eleva al inicio del módulo).
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }))

// Mock de `streamCompletion`: devuelve el async generator que configure cada
// prueba (emite la respuesta JSON controlada de Claude).
vi.mock('../chat/claudeProvider.js', () => ({
  streamCompletion: (messages: unknown) => streamMock(messages),
}))

// Se importa DESPUÉS del `vi.mock` para que `aiContent.ts` reciba el mock.
import { parseContenido, generateContentForPlatform } from './aiContent.js'

/** Async generator que emite una salida completa, opcionalmente troceada. */
function textStream(salida: string, chunks = 1) {
  return (async function* () {
    if (chunks <= 1) {
      yield salida
      return
    }
    const size = Math.ceil(salida.length / chunks)
    for (let i = 0; i < salida.length; i += size) {
      yield salida.slice(i, i + size)
    }
  })()
}

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// Valores de campo arbitrarios (cualquier cadena, incluyendo vacías y con
// caracteres especiales que JSON.stringify escapa y JSON.parse restaura).
const fieldValue = fc.string({ maxLength: 60 })

const contenido = fc.record({
  title: fieldValue,
  description: fieldValue,
  hashtags: fieldValue,
})

// Texto adicional que rodea al bloque JSON, SIN llaves para no interferir con
// la extracción del primer bloque `{...}` equilibrado.
const textoSinLlaves = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz ÁÉÍÓÚáéíóúñ.,;:\n¡!¿?-'.split('')
  ),
  { maxLength: 40 }
)

// Entrada "basura": cualquier cadena arbitraria (puede o no ser JSON válido).
const basura = fc.string({ maxLength: 120 })

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia — Capa de IA: parseContenido y generación (propiedades)', () => {
  // Feature: publicador-videos-ia, Property 5: Generación produce contenido
  // completo (nivel de parseo) — para JSON bien formado, parseContenido
  // devuelve los tres campos con los valores EXACTOS.
  // Validates: Requirements 3.1, 3.3
  it('Property 5: JSON bien formado devuelve los tres campos con valores exactos', () => {
    fc.assert(
      fc.property(contenido, (campos) => {
        const json = JSON.stringify(campos)
        const out = parseContenido(json)

        expect(out.title).toBe(campos.title)
        expect(out.description).toBe(campos.description)
        expect(out.hashtags).toBe(campos.hashtags)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 5: Generación produce contenido
  // completo (nivel de parseo) — JSON envuelto en vallas de código
  // (```json ... ```) sigue devolviendo los valores exactos.
  // Validates: Requirements 3.1, 3.3
  it('Property 5: JSON envuelto en vallas de código ```json``` devuelve los valores exactos', () => {
    fc.assert(
      fc.property(contenido, (campos) => {
        const json = JSON.stringify(campos)
        const conVallas = '```json\n' + json + '\n```'
        const out = parseContenido(conVallas)

        expect(out.title).toBe(campos.title)
        expect(out.description).toBe(campos.description)
        expect(out.hashtags).toBe(campos.hashtags)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 5: Generación produce contenido
  // completo (nivel de parseo) — JSON rodeado de texto adicional (sin llaves)
  // sigue produciendo los tres campos con los valores exactos del bloque.
  // Validates: Requirements 3.1, 3.3
  it('Property 5: JSON rodeado de texto extra devuelve los tres campos exactos', () => {
    fc.assert(
      fc.property(
        contenido,
        textoSinLlaves,
        textoSinLlaves,
        (campos, prefijo, sufijo) => {
          const json = JSON.stringify(campos)
          const out = parseContenido(prefijo + json + sufijo)

          expect(out.title).toBe(campos.title)
          expect(out.description).toBe(campos.description)
          expect(out.hashtags).toBe(campos.hashtags)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 5: Generación produce contenido
  // completo (nivel de parseo) — forma ESTABLE: para CUALQUIER entrada (incluida
  // basura no-JSON), parseContenido siempre devuelve un objeto con los tres
  // campos como cadenas.
  // Validates: Requirements 3.1, 3.3
  it('Property 5: cualquier entrada (incluida basura) devuelve los tres campos como cadenas', () => {
    fc.assert(
      fc.property(basura, (entrada) => {
        const out = parseContenido(entrada)

        expect(out).toBeTypeOf('object')
        expect(out).not.toBeNull()
        expect(typeof out.title).toBe('string')
        expect(typeof out.description).toBe('string')
        expect(typeof out.hashtags).toBe('string')
        // Las claves esperadas están presentes.
        expect(Object.keys(out).sort()).toEqual(
          ['description', 'hashtags', 'title'].sort()
        )
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: publicador-videos-ia, Property 5: Generación produce contenido
  // completo — `generateContentForPlatform` consume `streamCompletion`
  // (mockeado para emitir un JSON) y devuelve los tres campos con los valores
  // exactos para cualquier plataforma admitida.
  // Validates: Requirements 3.1, 3.3
  it('Property 5: generateContentForPlatform devuelve los tres campos del JSON emitido por Claude', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PLATAFORMAS),
        contenido,
        fc.string({ maxLength: 40 }),
        fc.webUrl(),
        fc.integer({ min: 1, max: 4 }),
        async (platform, campos, brief, videoUrl, chunks) => {
          streamMock.mockReset()
          const json = JSON.stringify(campos)
          streamMock.mockImplementation(() => textStream(json, chunks))

          const out = await generateContentForPlatform(brief, videoUrl, platform)

          // Se invocó al Proveedor_Claude (a través del mock).
          expect(streamMock).toHaveBeenCalledTimes(1)

          // Devuelve los tres campos con los valores exactos.
          expect(out.title).toBe(campos.title)
          expect(out.description).toBe(campos.description)
          expect(out.hashtags).toBe(campos.hashtags)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
