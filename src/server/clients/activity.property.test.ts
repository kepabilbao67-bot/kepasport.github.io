// Pruebas basadas en propiedades para el registro de actividad (Tarea 5.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre las propiedades de diseño 10, 11 y 12 con fast-check (mínimo 100
// iteraciones por propiedad). Las pruebas ejercitan la lógica REAL de
// `addActivity` (en `actions.ts`) y `getClient` (en `queries.ts`) contra un
// contexto Wasp en memoria (`createFakeContext`) que reproduce el subconjunto
// de la API de Prisma utilizado por el código bajo prueba. No se mockea la
// lógica de negocio.
//
// Validates: Requirements 4.1, 4.2, 4.3

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { HttpError } from 'wasp/server'

import { createClient, addActivity } from './actions.js'
import { getClient } from './queries.js'
import { createFakeContext } from '../../test/fakeContext.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const agentId = fc.integer({ min: 1, max: 1_000_000 })

// Entrada de cliente siempre válida (nombre y correo correctos).
const validClientInput = {
  name: 'Cliente de prueba',
  email: 'cliente@dominio.com',
}

// Contenido de actividad no vacío tras recortar espacios (Requisito 4.1).
const nonEmptyContent = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0)

// Contenido en blanco: vacío o compuesto solo por espacios (Requisito 4.3).
const blankContent = fc.constantFrom('', ' ', '   ', '\t', '\n', '  \t \n ')

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — Registro de actividad (propiedades)', () => {
  // Property 10: Round-trip de creación de actividad
  // Validates: Requirements 4.1
  it('Property 10: crear una actividad y leer el cliente incluye una entrada con el mismo contenido, marca de tiempo y asociación', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, nonEmptyContent, async (ownerId, content) => {
        const { context } = createFakeContext({ id: ownerId })
        const client = await createClient(validClientInput as any, context as any)

        const created = await addActivity(
          { clientId: client.id, content },
          context as any
        )

        // La actividad creada está asociada al cliente y tiene marca de tiempo.
        expect(created.clientId).toBe(client.id)
        expect(created.content).toBe(content)
        expect(created.createdAt).toBeDefined()
        expect(Number.isNaN(new Date(created.createdAt).getTime())).toBe(false)

        // Al leer el cliente, sus actividades incluyen la entrada creada.
        const read = await getClient({ id: client.id }, context as any)
        const match = (read as any).activities.find(
          (a: any) => a.id === created.id
        )
        expect(match).toBeDefined()
        expect(match.content).toBe(content)
        expect(match.clientId).toBe(client.id)
        expect(match.createdAt).toBeDefined()
        expect(Number.isNaN(new Date(match.createdAt).getTime())).toBe(false)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 11: Orden cronológico de actividades
  // Validates: Requirements 4.2
  it('Property 11: getClient devuelve las actividades en orden no decreciente por marca de tiempo', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), {
          minLength: 1,
          maxLength: 12,
        }),
        async (ownerId, timestamps) => {
          const { context } = createFakeContext({ id: ownerId })
          const client = await createClient(validClientInput as any, context as any)

          // Sembrar actividades con marcas de tiempo arbitrarias (en cualquier
          // orden) directamente sobre la entidad para ejercitar el orden de la
          // consulta de forma independiente de la hora de creación real.
          for (const ts of timestamps) {
            await context.entities.Activity.create({
              data: {
                content: 'nota',
                clientId: client.id,
                createdAt: new Date(ts),
              },
            })
          }

          const read = await getClient({ id: client.id }, context as any)
          const activities = (read as any).activities

          expect(activities).toHaveLength(timestamps.length)

          // Orden no decreciente por createdAt.
          for (let i = 1; i < activities.length; i++) {
            const prev = new Date(activities[i - 1].createdAt).getTime()
            const curr = new Date(activities[i].createdAt).getTime()
            expect(curr).toBeGreaterThanOrEqual(prev)
          }

          // Todas las actividades pertenecen al cliente consultado.
          expect(
            activities.every((a: any) => a.clientId === client.id)
          ).toBe(true)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 12: Validación de contenido de actividad
  // Validates: Requirements 4.3
  it('Property 12: contenido vacío o solo espacios se rechaza y no se persiste actividad', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, blankContent, async (ownerId, content) => {
        const { context, db } = createFakeContext({ id: ownerId })
        const client = await createClient(validClientInput as any, context as any)

        await expect(
          addActivity({ clientId: client.id, content }, context as any)
        ).rejects.toBeInstanceOf(HttpError)

        // No se persistió ninguna actividad.
        expect(db.activities).toHaveLength(0)
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
