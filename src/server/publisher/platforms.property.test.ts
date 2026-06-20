// Pruebas basadas en propiedades para el mapa de plataformas, la construcción
// del prompt por plataforma y la validación de creación del Publicador de
// Vídeos IA.
//
// Feature: publicador-videos-ia
//
// Ejercitan la lógica REAL de `buildPrompt` (`aiContent.ts`), el mapa real
// `platformGuides`/`PLATAFORMAS` (`platforms.ts`) y `validatePublicacion`
// (`validation.ts`). No se mockea nada: estas propiedades son puramente de
// dominio (construcción de cadenas y validación de entrada).
//
// Propiedades verificadas (mínimo 100 iteraciones cada una):
//
//   Property 6: Adaptación del prompt por plataforma — Validates: Requirements 3.2
//     Para cualquier plataforma del conjunto admitido, el prompt construido
//     contiene la etiqueta, el tono y los límites definidos para ella en
//     `platformGuides`.
//
//   Property 3: Validación de creación — Validates: Requirements 2.3, 2.4, 7.1
//     A nivel de `validatePublicacion`: una URL de vídeo vacía o compuesta solo
//     por espacios, o una selección de plataformas vacía, provoca un HttpError
//     (statusCode 400); una entrada válida no lanza.

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { HttpError } from 'wasp/server'
import { buildPrompt } from './aiContent.js'
import { platformGuides, PLATAFORMAS, type Platform } from './platforms.js'
import { validatePublicacion } from './validation.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// Texto arbitrario para el brief y la URL del vídeo. Se permite cualquier
// contenido razonable, incluyendo cadenas vacías, ya que `buildPrompt` no
// valida sus argumentos.
const textArb = fc.string({ maxLength: 80 })

// Cualquier plataforma del conjunto admitido.
const platformArb = fc.constantFrom<Platform>(...PLATAFORMAS)

// Cadenas compuestas exclusivamente por espacios en blanco (espacio, tab,
// salto de línea), que deben tratarse como URL "vacía".
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(''))

// URL de vídeo NO vacía (contiene al menos un carácter que no es espacio).
const nonEmptyUrlArb = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0)

// Selección no vacía de plataformas (subconjunto de las admitidas, sin duplicados).
const nonEmptyPlatformsArb = fc.uniqueArray(platformArb, { minLength: 1, maxLength: PLATAFORMAS.length })

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia — plataformas, prompt y validación (propiedades)', () => {
  // Property 6: Adaptación del prompt por plataforma.
  // Validates: Requirements 3.2
  it('Property 6: el prompt construido incluye la etiqueta, el tono y los límites de la plataforma', () => {
    fc.assert(
      fc.property(textArb, textArb, platformArb, (brief, videoUrl, platform) => {
        const prompt = buildPrompt(brief, videoUrl, platform)
        const guide = platformGuides[platform]

        // El prompt refleja la guía concreta de la plataforma seleccionada.
        expect(prompt).toContain(guide.label)
        expect(prompt).toContain(guide.tone)
        expect(prompt).toContain(guide.limits)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 3 (parte negativa): URL vacía o solo espacios → HttpError 400.
  // Validates: Requirements 2.3, 7.1
  it('Property 3: una URL de vídeo vacía o solo con espacios provoca HttpError 400', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(''), whitespaceArb),
        textArb,
        nonEmptyPlatformsArb,
        (videoUrl, brief, platforms) => {
          let lanzado: unknown
          try {
            validatePublicacion({ videoUrl, brief, platforms })
          } catch (err) {
            lanzado = err
          }
          expect(lanzado).toBeInstanceOf(HttpError)
          expect((lanzado as HttpError).statusCode).toBe(400)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 3 (parte negativa): selección de plataformas vacía → HttpError 400.
  // Validates: Requirements 2.4, 7.1
  it('Property 3: una selección de plataformas vacía provoca HttpError 400', () => {
    fc.assert(
      fc.property(nonEmptyUrlArb, textArb, (videoUrl, brief) => {
        let lanzado: unknown
        try {
          validatePublicacion({ videoUrl, brief, platforms: [] })
        } catch (err) {
          lanzado = err
        }
        expect(lanzado).toBeInstanceOf(HttpError)
        expect((lanzado as HttpError).statusCode).toBe(400)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 3 (parte positiva): entrada válida (URL no vacía + al menos una
  // plataforma) no lanza.
  // Validates: Requirements 2.3, 2.4, 7.1
  it('Property 3: una entrada válida (URL no vacía y al menos una plataforma) no lanza', () => {
    fc.assert(
      fc.property(nonEmptyUrlArb, textArb, nonEmptyPlatformsArb, (videoUrl, brief, platforms) => {
        expect(() => validatePublicacion({ videoUrl, brief, platforms })).not.toThrow()
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
