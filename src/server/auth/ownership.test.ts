import { describe, it, expect, beforeAll, vi } from 'vitest'
import fc from 'fast-check'

// ---------------------------------------------------------------------------
// El módulo `ownership.ts` importa `HttpError` desde 'wasp/server', que solo
// se resuelve dentro del contexto generado por la cadena de herramientas de
// Wasp. Para poder ejercitar la lógica de propiedad (rechazo de autenticación
// y aislamiento por propietario) fuera de ese entorno, se mockea el módulo con
// una clase HttpError mínima compatible.
// ---------------------------------------------------------------------------
vi.mock('wasp/server', () => {
  class HttpError extends Error {
    statusCode: number
    constructor(statusCode: number, message?: string) {
      super(message)
      this.name = 'HttpError'
      this.statusCode = statusCode
    }
  }
  return { HttpError }
})

// La importación se hace tras registrar el mock.
import { requireUser, requireOwnership } from './ownership'

const NUM_RUNS = 100

describe('Feature: claude-chatbot-assistant, Property 1: Rechazo de solicitudes no autenticadas', () => {
  // Para toda operación protegida invocada sin un usuario en el contexto, la
  // operación debe rechazarse con un error de autorización y no debe devolver
  // datos. Validates: Requirements 1.2
  it('requireUser lanza un error de autorización (401) cuando no hay usuario en el contexto', () => {
    fc.assert(
      fc.property(
        // Generamos contextos arbitrarios SIN usuario: user ausente, undefined o null.
        fc.oneof(
          fc.constant({} as { user?: { id: number } }),
          fc.constant({ user: undefined } as { user?: { id: number } }),
          fc.constant({ user: null } as unknown as { user?: { id: number } }),
          // Contextos con campos extra pero sin user.
          fc.record({ session: fc.string() }) as unknown as { user?: { id: number } }
        ),
        (context) => {
          const SENTINEL = Symbol('no-return')
          let returned: unknown = SENTINEL
          let threw = false
          let statusCode: number | undefined
          try {
            returned = requireUser(context)
          } catch (err) {
            threw = true
            statusCode = (err as { statusCode?: number }).statusCode
          }
          // Debe lanzar (rechazo), con código de autorización 401, y nunca
          // devolver un identificador (returned permanece en el centinela).
          expect(threw).toBe(true)
          expect(statusCode).toBe(401)
          expect(returned).toBe(SENTINEL)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  it('requireUser devuelve el id del agente cuando la sesión es válida (caso complementario)', () => {
    fc.assert(
      fc.property(fc.integer(), (id) => {
        expect(requireUser({ user: { id } })).toBe(id)
      }),
      { numRuns: NUM_RUNS }
    )
  })
})

describe('Feature: claude-chatbot-assistant, Property 3: Aislamiento por propietario en lecturas', () => {
  // Para todo registro perteneciente a otro Agente (o inexistente), la
  // comprobación de propiedad debe rechazarlo con un error de autorización; y
  // para todo registro propio, debe devolverlo. Validates: Requirements 1.4, 7.5
  it('requireOwnership rechaza (403) registros de otro propietario o nulos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer(),
        fc.integer(),
        async (ownerId, otherOwnerId) => {
          // Solo nos interesan los casos donde el propietario difiere.
          fc.pre(ownerId !== otherOwnerId)
          const record = { ownerId: otherOwnerId, data: 'secreto' }

          // Registro de otro agente -> rechazo 403.
          await expect(requireOwnership(record, ownerId)).rejects.toMatchObject({
            statusCode: 403,
          })

          // Registro inexistente (null) -> rechazo 403.
          await expect(requireOwnership(null, ownerId)).rejects.toMatchObject({
            statusCode: 403,
          })
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  it('requireOwnership devuelve el registro propio (caso complementario)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer(),
        fc.string(),
        async (ownerId, data) => {
          const record = { ownerId, data }
          await expect(requireOwnership(record, ownerId)).resolves.toBe(record)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
