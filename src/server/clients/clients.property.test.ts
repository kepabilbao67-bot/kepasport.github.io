// Pruebas basadas en propiedades para el CRUD de clientes (Tarea 4.4).
//
// Feature: claude-chatbot-assistant
//
// Cubre las propiedades de diseño 2, 4, 5, 6, 7 y 8 con fast-check (mínimo 100
// iteraciones por propiedad). Las pruebas ejercitan la lógica REAL de
// `actions.ts` y `queries.ts` contra un contexto Wasp en memoria
// (`createFakeContext`) que reproduce el subconjunto de la API de Prisma
// utilizado por el código bajo prueba. No se mockea la lógica de negocio.
//
// Validates: Requirements 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { HttpError } from 'wasp/server'

import { createClient, updateClient, deleteClient } from './actions.js'
import { getClients, getClient } from './queries.js'
import { EMAIL_RE } from './validation.js'
import { createFakeContext } from '../../test/fakeContext.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// Segmento alfanumérico no vacío y sin espacios ni '@' (apto para emails).
const segment = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
    ),
    { minLength: 1, maxLength: 8 }
  )
  .map((chars) => chars.join(''))

// Correo electrónico que SIEMPRE satisface EMAIL_RE: local@dominio.tld
const validEmail = fc
  .tuple(segment, segment, segment)
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)

// Nombre no vacío tras recortar espacios.
const nonEmptyName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0)

const optionalText = fc.option(fc.string({ maxLength: 30 }), { nil: undefined })

const validClientInput = fc.record({
  name: nonEmptyName,
  email: validEmail,
  phone: optionalText,
  company: optionalText,
  status: optionalText,
  notes: optionalText,
})

const agentId = fc.integer({ min: 1, max: 1_000_000 })

// Cadenas en blanco (vacías o solo espacios) para violar la obligatoriedad.
const blank = fc.constantFrom('', ' ', '   ', '\t', '\n', '  \t ')

// Email no vacío pero con formato inválido (falla EMAIL_RE).
const malformedEmail = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !EMAIL_RE.test(s))

// Entrada inválida: nombre en blanco, o email en blanco, o email mal formado.
const invalidClientInput = fc.oneof(
  fc.record({
    name: blank,
    email: validEmail,
    phone: optionalText,
    company: optionalText,
    status: optionalText,
    notes: optionalText,
  }),
  fc.record({
    name: nonEmptyName,
    email: blank,
    phone: optionalText,
    company: optionalText,
    status: optionalText,
    notes: optionalText,
  }),
  fc.record({
    name: nonEmptyName,
    email: malformedEmail,
    phone: optionalText,
    company: optionalText,
    status: optionalText,
    notes: optionalText,
  })
)

const PROVIDED_FIELDS = ['name', 'email', 'phone', 'company', 'status', 'notes'] as const

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — CRUD de clientes (propiedades)', () => {
  // Property 2: Asociación del propietario al crear registros
  // Validates: Requirements 1.3
  it('Property 2: el cliente creado se asocia al ownerId del Agente', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, validClientInput, async (ownerId, input) => {
        const { context, db } = createFakeContext({ id: ownerId })
        const created = await createClient(input as any, context as any)

        expect(created.ownerId).toBe(ownerId)
        // El estado persistido refleja el mismo propietario.
        expect(db.clients).toHaveLength(1)
        expect(db.clients[0].ownerId).toBe(ownerId)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 4: Round-trip de creación y lectura de cliente
  // Validates: Requirements 2.1
  it('Property 4: crear y luego leer devuelve los mismos valores proporcionados', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, validClientInput, async (ownerId, input) => {
        const { context } = createFakeContext({ id: ownerId })
        const created = await createClient(input as any, context as any)
        const read = await getClient({ id: created.id }, context as any)

        for (const field of PROVIDED_FIELDS) {
          expect((read as any)[field]).toEqual((input as any)[field])
        }
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 5: Validación de entrada de cliente
  // Validates: Requirements 2.2, 2.3
  it('Property 5 (create): entrada inválida se rechaza y el estado no cambia', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, invalidClientInput, async (ownerId, input) => {
        const { context, db } = createFakeContext({ id: ownerId })

        await expect(createClient(input as any, context as any)).rejects.toBeInstanceOf(
          HttpError
        )
        // No se persistió ningún cliente.
        expect(db.clients).toHaveLength(0)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  it('Property 5 (update): edición inválida se rechaza y el estado no cambia', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        validClientInput,
        invalidClientInput,
        async (ownerId, valid, invalid) => {
          const { context, db } = createFakeContext({ id: ownerId })
          const created = await createClient(valid as any, context as any)
          const snapshot = JSON.parse(JSON.stringify(db.clients[0]))

          await expect(
            updateClient({ id: created.id, ...(invalid as any) }, context as any)
          ).rejects.toBeInstanceOf(HttpError)

          // El registro almacenado permanece idéntico.
          expect(db.clients).toHaveLength(1)
          expect(JSON.parse(JSON.stringify(db.clients[0]))).toEqual(snapshot)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 6: Round-trip de edición de cliente
  // Validates: Requirements 2.4
  it('Property 6: tras editar, la lectura refleja los valores actualizados', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        validClientInput,
        validClientInput,
        async (ownerId, initial, update) => {
          const { context } = createFakeContext({ id: ownerId })
          const created = await createClient(initial as any, context as any)

          await updateClient({ id: created.id, ...(update as any) }, context as any)
          const read = await getClient({ id: created.id }, context as any)

          // Semántica de Prisma (en la que se apoya el diseño): un campo con
          // valor `undefined` en la actualización NO se modifica (conserva su
          // valor previo). La Property 6 afirma sobre "los campos modificados",
          // es decir, los efectivamente proporcionados (valor definido).
          for (const field of PROVIDED_FIELDS) {
            const updateValue = (update as any)[field]
            const expected = updateValue !== undefined ? updateValue : (created as any)[field]
            expect((read as any)[field]).toEqual(expected)
          }
          // La propiedad se conserva tras la edición.
          expect((read as any).ownerId).toBe(ownerId)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 7: Eliminación en cascada de actividades
  // Validates: Requirements 2.5
  it('Property 7: eliminar un cliente no deja actividades asociadas', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        validClientInput,
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 10 }),
        async (ownerId, input, activityContents) => {
          const { context, db } = createFakeContext({ id: ownerId })
          const created = await createClient(input as any, context as any)

          // Sembrar un número arbitrario de actividades asociadas al cliente.
          for (const content of activityContents) {
            await context.entities.Activity.create({
              data: { content, clientId: created.id, createdAt: new Date() },
            })
          }
          // Algo de ruido: actividad de otro cliente que NO debe verse afectada.
          await context.entities.Activity.create({
            data: { content: 'otro', clientId: created.id + 999, createdAt: new Date() },
          })

          await deleteClient({ id: created.id }, context as any)

          const remaining = await context.entities.Activity.findMany({
            where: { clientId: created.id },
          })
          expect(remaining).toHaveLength(0)
          // El cliente también se eliminó.
          expect(db.clients.find((c) => c.id === created.id)).toBeUndefined()
          // La actividad de otro cliente permanece intacta.
          expect(db.activities.some((a) => a.clientId === created.id + 999)).toBe(true)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 8: Orden del listado de clientes por actividad reciente
  // Validates: Requirements 2.6
  it('Property 8: getClients devuelve los clientes en orden no creciente por lastActivityAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 12 }),
        async (ownerId, timestamps) => {
          const { context } = createFakeContext({ id: ownerId })

          // Sembrar clientes propios con marcas de última actividad arbitrarias.
          for (const ts of timestamps) {
            await context.entities.Client.create({
              data: {
                name: 'Cliente',
                email: 'c@dominio.com',
                ownerId,
                lastActivityAt: new Date(ts),
              },
            })
          }

          const listed = await getClients(undefined, context as any)

          // Todos pertenecen al Agente.
          expect(listed.every((c: any) => c.ownerId === ownerId)).toBe(true)
          expect(listed).toHaveLength(timestamps.length)

          // Orden no creciente por lastActivityAt.
          for (let i = 1; i < listed.length; i++) {
            const prev = new Date(listed[i - 1].lastActivityAt).getTime()
            const curr = new Date(listed[i].lastActivityAt).getTime()
            expect(prev).toBeGreaterThanOrEqual(curr)
          }
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
