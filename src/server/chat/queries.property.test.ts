// Pruebas basadas en propiedades para la recuperación de conversaciones (Tarea 9.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre la propiedad de diseño 21 con fast-check (mínimo 100 iteraciones por
// propiedad). Las pruebas ejercitan la lógica REAL de `getConversations` y
// `getMessages` (en `queries.ts`) contra un contexto Wasp en memoria
// (`makeEntity`/`makeContext`) que reproduce el subconjunto de la API de Prisma
// utilizado por el código bajo prueba (incluyendo `where` por `ownerId`,
// `findUnique` y `orderBy` ascendente/descendente). No se mockea la lógica de
// negocio: el orden esperado se calcula de forma independiente y se compara.
//
// Validates: Requirements 7.3, 7.4

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { HttpError } from 'wasp/server'

import { getConversations, getMessages } from './queries.js'
import { makeEntity, makeContext } from '../../test/mockContext.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const agentId = fc.integer({ min: 1, max: 1000 })

// Marca de tiempo arbitraria (en milisegundos desde época).
const ts = fc.integer({ min: 0, max: 10_000_000 })

// Conjunto de conversaciones: cada una con un Agente propietario arbitrario y
// una marca de actividad (`updatedAt`) ÚNICA, de modo que el orden por
// `updatedAt` descendente sea determinista y comparable de forma exacta.
const conversationSet = fc
  .array(agentId, { minLength: 1, maxLength: 15 })
  .chain((owners) =>
    fc
      .uniqueArray(ts, {
        minLength: owners.length,
        maxLength: owners.length,
      })
      .map((times) =>
        owners.map((owner, i) => ({ owner, updatedAt: times[i] }))
      )
  )

// Conjunto de mensajes de una conversación: marcas de creación ÚNICAS, en orden
// arbitrario, para ejercitar el orden cronológico de forma independiente del
// orden de inserción.
const messageSet = fc.uniqueArray(ts, { minLength: 1, maxLength: 20 })

// Par de Agentes DISTINTOS (propietario y observador) para el aislamiento.
const distinctAgents = fc
  .tuple(agentId, agentId)
  .filter(([a, b]) => a !== b)

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — Recuperación de conversaciones (propiedades)', () => {
  // Feature: claude-chatbot-assistant, Property 21: Orden de recuperación de
  // conversaciones y mensajes — getConversations ordena de forma no creciente
  // por actividad reciente (updatedAt desc) y solo devuelve las del Agente.
  // Validates: Requirements 7.3
  it('Property 21 (conversaciones): getConversations devuelve solo las del Agente, ordenadas por updatedAt descendente', async () => {
    await fc.assert(
      fc.asyncProperty(
        conversationSet,
        agentId,
        async (specs, viewer) => {
          const Conversation = makeEntity()
          const created = []
          for (const s of specs) {
            created.push(
              await Conversation.create({
                data: { ownerId: s.owner, updatedAt: new Date(s.updatedAt) },
              })
            )
          }

          const context = makeContext({ Conversation }, viewer)
          const listed = await getConversations(undefined, context as any)

          // Aislamiento: todas las conversaciones devueltas son del observador.
          expect(listed.every((c: any) => c.ownerId === viewer)).toBe(true)

          // Orden esperado calculado de forma independiente: las del observador,
          // ordenadas de forma no creciente por updatedAt (marcas únicas =>
          // orden determinista).
          const expectedIds = created
            .filter((c: any) => c.ownerId === viewer)
            .sort(
              (a: any, b: any) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime()
            )
            .map((c: any) => c.id)

          expect(listed.map((c: any) => c.id)).toEqual(expectedIds)

          // Comprobación directa de la monotonía (no creciente).
          for (let i = 1; i < listed.length; i++) {
            const prev = new Date(listed[i - 1].updatedAt).getTime()
            const curr = new Date(listed[i].updatedAt).getTime()
            expect(prev).toBeGreaterThanOrEqual(curr)
          }
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 21: Orden de recuperación de
  // conversaciones y mensajes — getMessages carga los mensajes de una
  // conversación en orden cronológico no decreciente (createdAt asc).
  // Validates: Requirements 7.4
  it('Property 21 (mensajes): getMessages carga los mensajes en orden cronológico ascendente', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        messageSet,
        async (ownerId, timestamps) => {
          const Conversation = makeEntity()
          const Message = makeEntity()

          const conversation = await Conversation.create({
            data: { ownerId, updatedAt: new Date(0) },
          })

          const created = []
          for (const t of timestamps) {
            created.push(
              await Message.create({
                data: {
                  conversationId: conversation.id,
                  role: 'user',
                  content: `msg-${t}`,
                  createdAt: new Date(t),
                },
              })
            )
          }

          const context = makeContext({ Conversation, Message }, ownerId)
          const loaded = await getMessages(
            { conversationId: conversation.id },
            context as any
          )

          // Todos los mensajes pertenecen a la conversación consultada.
          expect(
            loaded.every((m: any) => m.conversationId === conversation.id)
          ).toBe(true)

          // Orden esperado independiente: ascendente por createdAt (único).
          const expectedIds = created
            .slice()
            .sort(
              (a: any, b: any) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime()
            )
            .map((m: any) => m.id)

          expect(loaded.map((m: any) => m.id)).toEqual(expectedIds)

          // Comprobación directa de la monotonía (no decreciente).
          for (let i = 1; i < loaded.length; i++) {
            const prev = new Date(loaded[i - 1].createdAt).getTime()
            const curr = new Date(loaded[i].createdAt).getTime()
            expect(curr).toBeGreaterThanOrEqual(prev)
          }
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 21: Orden de recuperación de
  // conversaciones y mensajes — aislamiento por propietario: getMessages
  // rechaza el acceso a una conversación de otro Agente (Requisito 7.5).
  // Validates: Requirements 7.4
  it('Property 21 (aislamiento): getMessages rechaza conversaciones de otro Agente', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctAgents,
        messageSet,
        async ([owner, intruder], timestamps) => {
          const Conversation = makeEntity()
          const Message = makeEntity()

          const conversation = await Conversation.create({
            data: { ownerId: owner, updatedAt: new Date(0) },
          })
          for (const t of timestamps) {
            await Message.create({
              data: {
                conversationId: conversation.id,
                role: 'user',
                content: `msg-${t}`,
                createdAt: new Date(t),
              },
            })
          }

          // El intruso (Agente distinto) no puede leer los mensajes.
          const context = makeContext({ Conversation, Message }, intruder)
          await expect(
            getMessages({ conversationId: conversation.id }, context as any)
          ).rejects.toBeInstanceOf(HttpError)

          // El propietario sí los recupera (control positivo).
          const ownerContext = makeContext({ Conversation, Message }, owner)
          const loaded = await getMessages(
            { conversationId: conversation.id },
            ownerContext as any
          )
          expect(loaded).toHaveLength(timestamps.length)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
