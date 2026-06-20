// Pruebas basadas en propiedades para el Constructor_Contexto (Tarea 8.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre las propiedades de diseño 13 y 17 con fast-check (mínimo 100
// iteraciones por propiedad). Las pruebas ejercitan la lógica REAL de
// `buildContext` (en `context.ts`), que es una función pura y síncrona: se la
// invoca directamente con arreglos de historial, objetos de cliente y
// actividades generados. No se mockea la lógica de negocio.
//
// Validates: Requirements 5.1, 6.1, 6.2

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { buildContext, serializeClient } from './context.js'
import type { ChatMessage } from './claudeProvider.js'

const NUM_RUNS = 100

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// Un mensaje de chat: rol válido y contenido textual arbitrario.
const chatMessage: fc.Arbitrary<ChatMessage> = fc.record({
  role: fc.constantFrom('user', 'assistant') as fc.Arbitrary<
    'user' | 'assistant'
  >,
  content: fc.string({ maxLength: 60 }),
})

// Historial de conversación no vacío (al menos el nuevo mensaje al final).
const nonEmptyHistory = fc.array(chatMessage, { minLength: 1, maxLength: 15 })

const optionalText = fc.option(fc.string({ maxLength: 30 }), { nil: undefined })

// Cliente con la forma usada por `serializeClient`. Como `Client` es un tipo
// eliminado en tiempo de ejecución (type-only desde `wasp/entities`), basta con
// generar los campos de dominio relevantes.
const clientArb = fc.record({
  id: fc.integer({ min: 1, max: 1_000_000 }),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  email: fc.string({ minLength: 1, maxLength: 30 }),
  phone: optionalText,
  company: optionalText,
  status: optionalText,
  notes: optionalText,
})

// Actividad con marca de tiempo y contenido (forma usada por buildContext).
const activityArb = fc.record({
  id: fc.integer({ min: 1, max: 1_000_000 }),
  clientId: fc.integer({ min: 1, max: 1_000_000 }),
  content: fc.string({ minLength: 1, maxLength: 40 }),
  createdAt: fc
    .integer({ min: 0, max: 10_000_000_000_000 })
    .map((ms) => new Date(ms)),
})

const anyIntent = fc.constantFrom('chat', 'draft', 'summary') as fc.Arbitrary<
  'chat' | 'draft' | 'summary'
>

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — Constructor_Contexto (propiedades)', () => {
  // Property 13: El contexto enviado incluye el historial de la conversación
  // Validates: Requirements 5.1
  //
  // Para todo historial, `buildContext` devuelve el historial (en orden) tras
  // cualquier preámbulo; es decir, los mensajes previos aparecen en orden antes
  // del nuevo mensaje.
  it('Property 13: el historial aparece, en orden, tras el preámbulo (mensajes previos antes del nuevo)', () => {
    fc.assert(
      fc.property(
        nonEmptyHistory,
        anyIntent,
        // El cliente y las actividades son opcionales: pueden generar un
        // preámbulo o no, pero el historial debe conservarse íntegro y en orden.
        fc.option(clientArb, { nil: undefined }),
        fc.option(fc.array(activityArb, { maxLength: 8 }), { nil: undefined }),
        (history, intent, client, activities) => {
          const result = buildContext({
            history: history as ChatMessage[],
            intent,
            client: client as any,
            activities: activities as any,
          })

          // El preámbulo precede al historial; su tamaño es 0 o 1.
          const preambleLength = result.length - history.length
          expect(preambleLength).toBeGreaterThanOrEqual(0)
          expect(preambleLength).toBeLessThanOrEqual(1)

          // El sufijo del contexto es exactamente el historial, en el mismo orden.
          const suffix = result.slice(preambleLength)
          expect(suffix).toEqual(history)

          // En particular, los mensajes previos preceden al nuevo mensaje
          // (último elemento del historial) conservando su orden relativo.
          const newMessage = history[history.length - 1]
          expect(result[result.length - 1]).toEqual(newMessage)
          for (let i = 0; i < history.length; i++) {
            expect(result[preambleLength + i]).toEqual(history[i])
          }
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 17: El contexto de cliente incluye sus datos
  // Validates: Requirements 6.1, 6.2
  //
  // Para todo cliente propio sobre el que se solicita redactar ('draft') o
  // resumir ('summary'), el contexto incluye los datos de ese cliente; y además
  // sus actividades cuando la solicitud es de resumen.
  it('Property 17: el contexto incluye los datos del cliente (y sus actividades cuando intent === "summary")', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessage, { maxLength: 10 }),
        fc.constantFrom('draft', 'summary') as fc.Arbitrary<
          'draft' | 'summary'
        >,
        clientArb,
        fc.array(activityArb, { minLength: 1, maxLength: 8 }),
        (history, intent, client, activities) => {
          const result = buildContext({
            history: history as ChatMessage[],
            intent,
            client: client as any,
            activities: activities as any,
          })

          // Existe un preámbulo (mensaje de rol 'user') al inicio del contexto.
          expect(result.length).toBe(history.length + 1)
          const preamble = result[0]
          expect(preamble.role).toBe('user')

          // El preámbulo contiene los datos serializados del cliente (Req 6.1).
          const expectedClientData = `Datos del cliente: ${JSON.stringify(
            serializeClient(client as any)
          )}`
          expect(preamble.content).toContain(expectedClientData)

          if (intent === 'summary') {
            // Al resumir, se incluyen además las actividades del cliente (Req 6.2).
            const expectedActivity = `Actividad: ${activities
              .map((a) => `${a.createdAt}: ${a.content}`)
              .join('\n')}`
            expect(preamble.content).toContain(expectedActivity)
            for (const a of activities) {
              expect(preamble.content).toContain(a.content)
            }
          } else {
            // Al redactar, NO se incluye la sección de actividad.
            expect(preamble.content).not.toContain('Actividad:')
          }

          // El historial se conserva, en orden, tras el preámbulo (Req 5.1).
          expect(result.slice(1)).toEqual(history)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
