// Prueba basada en propiedades: deduplicación de destinos de salida.
//
// Feature: publicador-videos-ia, Property 12
//
// El despachador de publicación (`publicarEnDestinos`) REUTILIZA
// `resolverDestinos()` de `src/server/integrations/outbound.ts`, que combina la
// lista genérica `OUTBOUND_WEBHOOK_URLS` (separada por comas/espacios) con el
// destino heredado `ZAPIER_WEBHOOK_URL` y elimina duplicados. Esta propiedad
// ejercita esa lógica REAL: el único estado que se manipula es el entorno de
// proceso, que se guarda y restaura en cada caso.
//
// **Property 12: Deduplicación de destinos de salida**
// **Validates: Requirements 5.2, 8.4**
//
// Para cualquier lista de URLs (sin caracteres separadores) que pueda contener
// duplicados, unida con comas/espacios aleatorios en `OUTBOUND_WEBHOOK_URLS`
// (y opcionalmente con `ZAPIER_WEBHOOK_URL` fijada a una de ellas),
// `resolverDestinos()` devuelve una lista SIN duplicados cuyo conjunto coincide
// con el conjunto de URLs de entrada distintas.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { resolverDestinos } from '../integrations/outbound.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// URLs válidas y NO vacías que NO contienen separadores de lista (comas o
// cualquier espacio en blanco), ya que tales caracteres no forman parte de una
// URL individual dentro de `OUTBOUND_WEBHOOK_URLS`.
const urlArb = fc.webUrl().filter((u) => u.length > 0 && !/[\s,]/.test(u))

// Lista de URLs que PUEDE contener duplicados (mínimo una entrada).
const urlsWithDuplicatesArb = fc.array(urlArb, { minLength: 1, maxLength: 6 })

// Separadores válidos para `OUTBOUND_WEBHOOK_URLS`: comas y/o espacios en
// blanco. Se generan combinaciones aleatorias para ejercitar el parseo.
const separatorArb = fc.constantFrom(',', ', ', ' ', '  ', ' , ', ',  ', '\n', '\t', ' ,\n')

// ---------------------------------------------------------------------------

describe('Feature: publicador-videos-ia, Property 12 — deduplicación de destinos de salida', () => {
  let originalOutbound: string | undefined
  let originalZapier: string | undefined

  beforeEach(() => {
    originalOutbound = process.env.OUTBOUND_WEBHOOK_URLS
    originalZapier = process.env.ZAPIER_WEBHOOK_URL
    delete process.env.OUTBOUND_WEBHOOK_URLS
    delete process.env.ZAPIER_WEBHOOK_URL
  })

  afterEach(() => {
    if (originalOutbound === undefined) delete process.env.OUTBOUND_WEBHOOK_URLS
    else process.env.OUTBOUND_WEBHOOK_URLS = originalOutbound
    if (originalZapier === undefined) delete process.env.ZAPIER_WEBHOOK_URL
    else process.env.ZAPIER_WEBHOOK_URL = originalZapier
  })

  // Validates: Requirements 5.2, 8.4
  it('resolverDestinos() no produce duplicados y su conjunto es el de las URLs distintas de entrada', () => {
    fc.assert(
      fc.property(
        urlsWithDuplicatesArb,
        // Lista de separadores con la que unir cada par de URLs adyacentes.
        fc.array(separatorArb, { minLength: 6, maxLength: 6 }),
        // Si se debe fijar también ZAPIER_WEBHOOK_URL, y a cuál de las URLs.
        fc.boolean(),
        fc.nat(),
        (urls, separators, useZapier, zapierSeed) => {
          // Partir de un entorno limpio en CADA iteración. `beforeEach` se
          // ejecuta una sola vez por `it`, no por iteración de fast-check, así
          // que hay que aislar el estado de proceso aquí para que un valor de
          // una iteración previa no se filtre a la siguiente.
          delete process.env.OUTBOUND_WEBHOOK_URLS
          delete process.env.ZAPIER_WEBHOOK_URL

          // Unir las URLs (posiblemente duplicadas) usando separadores variados,
          // de modo que `OUTBOUND_WEBHOOK_URLS` mezcle comas y espacios.
          let raw = urls[0]
          for (let i = 1; i < urls.length; i++) {
            raw += separators[i % separators.length] + urls[i]
          }
          process.env.OUTBOUND_WEBHOOK_URLS = raw

          // Conjunto esperado de destinos: las URLs distintas de la lista...
          const expected = new Set(urls)

          // ...más, opcionalmente, el destino heredado de Zapier (que ya
          // pertenece a la lista, por lo que NO debe introducir un nuevo destino
          // ni un duplicado).
          if (useZapier) {
            const zapierUrl = urls[zapierSeed % urls.length]
            process.env.ZAPIER_WEBHOOK_URL = zapierUrl
            expected.add(zapierUrl) // ya presente: el conjunto no cambia
          }

          const resultado = resolverDestinos()

          // (1) No hay duplicados en la salida.
          expect(resultado.length).toBe(new Set(resultado).size)

          // (2) El conjunto de la salida coincide con el de las URLs distintas.
          expect(new Set(resultado)).toEqual(expected)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
