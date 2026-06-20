import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { searchClients } from './queries.js'
import { makeEntity, makeContext } from '../../test/mockContext.js'

/**
 * Pruebas basadas en propiedades para `searchClients`.
 *
 * Feature: claude-chatbot-assistant, Property 9: Correctitud y completitud de
 * la búsqueda.
 *
 * Estrategia
 * ----------
 * `searchClients` no contiene la lógica de filtrado: construye una cláusula
 * `where` de Prisma (`ownerId` + `OR` de `contains`/`mode: 'insensitive'` sobre
 * name/email/company) y delega en `context.entities.Client.findMany`. El
 * ayudante `makeEntity` emula `findMany` interpretando esa cláusula de forma
 * GENÉRICA, sin conocer la propiedad. La prueba calcula, de forma totalmente
 * INDEPENDIENTE, el conjunto esperado a partir de la definición de la propiedad
 * y comprueba que coincide exactamente con el resultado real. Así, un `where`
 * mal construido (campo omitido, comparación sensible a mayúsculas, o falta de
 * aislamiento por propietario) haría divergir ambos conjuntos y fallar la
 * prueba.
 */

// Alfabeto pequeño para que los términos aleatorios colisionen a menudo con el
// contenido de los campos, cubriendo tanto coincidencias como no coincidencias.
const CHARS = ['a', 'A', 'b', 'B', 'c', 'C', 'd', 'D', '1', '2']
const charArb = fc.constantFrom(...CHARS)

const wordArb = (maxLength: number) =>
  fc.array(charArb, { maxLength }).map((a) => a.join(''))

const emailArb = fc
  .tuple(wordArb(5), fc.constantFrom('correo.com', 'ejemplo.org', 'x.net'))
  .map(([user, domain]) => `${user}@${domain}`)

const rawClientArb = fc.record({
  ownerId: fc.integer({ min: 1, max: 3 }),
  name: wordArb(6),
  email: emailArb,
  // `company` es opcional/anulable en el esquema Prisma.
  company: fc.option(wordArb(6), { nil: null }),
  lastActivityAt: fc.integer({ min: 0, max: 1_000_000 }),
})

// Término de búsqueda: a veces rodeado de espacios, ya que `searchClients`
// normaliza recortando (`term.trim()`).
const termArb = fc
  .tuple(wordArb(4), fc.constantFrom('', ' ', '  ', '\t'))
  .map(([term, pad]) => `${pad}${term}${pad}`)

/** Conjunto esperado calculado de forma independiente desde la Property 9. */
function expectedMatches(
  clients: Array<{
    id: number
    ownerId: number
    name: string
    email: string
    company: string | null
  }>,
  ownerId: number,
  term: string
): number[] {
  const t = (term ?? '').trim().toLowerCase()
  return clients
    .filter((c) => c.ownerId === ownerId)
    .filter((c) =>
      [c.name, c.email, c.company].some(
        (field) => field != null && field.toLowerCase().includes(t)
      )
    )
    .map((c) => c.id)
    .sort((a, b) => a - b)
}

describe('searchClients (Property 9: Correctitud y completitud de la búsqueda)', () => {
  it('devuelve exactamente los clientes propios cuyo nombre, correo o empresa contienen el término (sin distinguir mayúsculas)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rawClientArb, { maxLength: 10 }),
        fc.integer({ min: 1, max: 3 }),
        termArb,
        async (rawClients, requestingOwnerId, term) => {
          // Asignar identificadores únicos y estables.
          const clients = rawClients.map((c, i) => ({ id: i + 1, ...c }))

          const Client = makeEntity(clients)
          const context = makeContext({ Client }, requestingOwnerId)

          const result = await searchClients({ term }, context as any)
          const actualIds = result.map((c: any) => c.id).sort((a: number, b: number) => a - b)

          const expectedIds = expectedMatches(clients, requestingOwnerId, term)

          // Completitud + correctitud: el conjunto coincide exactamente.
          expect(actualIds).toEqual(expectedIds)

          // Aislamiento por propietario reforzado: ningún resultado ajeno.
          expect(result.every((c: any) => c.ownerId === requestingOwnerId)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('un término vacío (o solo espacios) devuelve todos los clientes propios', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rawClientArb, { maxLength: 10 }),
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom('', '   ', '\t', '  \t '),
        async (rawClients, requestingOwnerId, blankTerm) => {
          const clients = rawClients.map((c, i) => ({ id: i + 1, ...c }))
          const Client = makeEntity(clients)
          const context = makeContext({ Client }, requestingOwnerId)

          const result = await searchClients({ term: blankTerm }, context as any)
          const actualIds = result.map((c: any) => c.id).sort((a: number, b: number) => a - b)

          const expectedIds = clients
            .filter((c) => c.ownerId === requestingOwnerId)
            .map((c) => c.id)
            .sort((a, b) => a - b)

          expect(actualIds).toEqual(expectedIds)
        }
      ),
      { numRuns: 100 }
    )
  })
})
