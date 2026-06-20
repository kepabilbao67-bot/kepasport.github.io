// Pruebas basadas en propiedades para el endpoint SSE del asistente (Tarea 10.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre las propiedades de diseño 14, 16, 18, 19, 20 y 24 con fast-check
// (mínimo 100 iteraciones por propiedad). Las pruebas ejercitan la lógica REAL
// del manejador `chatStream` (en `stream.ts`) contra:
//   - un contexto Wasp en memoria (`makeEntity`/`makeContext`) que reproduce el
//     subconjunto de la API de Prisma usado por el código bajo prueba, y
//   - un `res` de Express simulado que captura `status()/json()/writeHead()/
//     write()/end()` y los marcos SSE emitidos.
//
// La ÚNICA dependencia mockeada es `streamCompletion` del Proveedor_Claude (para
// no llamar a Anthropic): se controla la secuencia de tokens emitida y, para la
// Propiedad 24, se fuerza un error a mitad del stream. La lógica de validación,
// propiedad, persistencia y reensamblado del texto NO se mockea.
//
// Validates: Requirements 5.2, 5.4, 5.5, 6.3, 7.1, 7.2, 9.1

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { HttpError } from 'wasp/server'

import { makeEntity, makeContext } from '../../test/mockContext.js'

const NUM_RUNS = 100

// Espía del Proveedor_Claude creado con `vi.hoisted` para poder referenciarlo
// dentro de la fábrica de `vi.mock` (que se eleva al inicio del módulo).
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }))

// Mock de `streamCompletion`: devuelve lo que configure cada prueba (un async
// generator de tokens o uno que lanza a mitad del stream).
vi.mock('./claudeProvider.js', () => ({
  streamCompletion: (messages: unknown) => streamMock(messages),
}))

// Se importa DESPUÉS del `vi.mock` para que `stream.ts` reciba el mock.
import { chatStream } from './stream.js'

// --- `res` de Express simulado ---------------------------------------------

type FakeRes = {
  statusCode?: number
  jsonBody?: unknown
  headers?: Record<string, string>
  ended: boolean
  _writes: string[]
  status(code: number): FakeRes
  json(body: unknown): FakeRes
  writeHead(code: number, headers?: Record<string, string>): FakeRes
  write(chunk: string): boolean
  end(): FakeRes
}

function makeRes(): FakeRes {
  const writes: string[] = []
  const res: FakeRes = {
    ended: false,
    _writes: writes,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.jsonBody = body
      return this
    },
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers
      return this
    },
    write(chunk) {
      writes.push(chunk)
      return true
    },
    end() {
      this.ended = true
      return this
    },
  }
  return res
}

/** Extrae los datos (`data:`) de los marcos SSE cuyo `event:` coincide. */
function dataForEvent(writes: string[], event: string): string[] {
  const out: string[] = []
  for (const frame of writes) {
    const lines = frame.split('\n')
    let ev: string | undefined
    let data: string | undefined
    for (const line of lines) {
      if (line.startsWith('event: ')) ev = line.slice('event: '.length)
      else if (line.startsWith('data: ')) data = line.slice('data: '.length)
    }
    if (ev === event && data !== undefined) out.push(data)
  }
  return out
}

/** Tokens reensamblados a partir de los marcos `event: token` (cada `data` es JSON). */
function tokensFromFrames(writes: string[]): string[] {
  return dataForEvent(writes, 'token').map((d) => JSON.parse(d) as string)
}

function hasEvent(writes: string[], event: string): boolean {
  return dataForEvent(writes, event).length > 0
}

/** Async generator de tokens. */
function tokenStream(tokens: string[]) {
  return (async function* () {
    for (const t of tokens) yield t
  })()
}

/** Async generator que emite algunos tokens y luego lanza (error a mitad). */
function failingStream(tokens: string[]) {
  return (async function* () {
    for (const t of tokens) yield t
    throw new Error('fallo del modelo')
  })()
}

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

const agentId = fc.integer({ min: 1, max: 1000 })

// Contenido no vacío del Agente (al menos un carácter que no sea espacio).
const nonEmptyContent = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0)

// Contenido vacío o compuesto solo por espacios en blanco.
const blankContent = fc.oneof(
  fc.constant(''),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), {
    minLength: 1,
    maxLength: 12,
  })
)

// Secuencia arbitraria de tokens (las cadenas pueden incluir cualquier carácter).
const tokenSeq = fc.array(fc.string({ maxLength: 12 }), { maxLength: 20 })

// Secuencia no vacía de tokens (para forzar al menos un token antes del fallo).
const nonEmptyTokenSeq = fc.array(fc.string({ maxLength: 12 }), {
  minLength: 1,
  maxLength: 20,
})

// Dos Agentes distintos: propietario del Cliente e intruso solicitante.
const distinctAgents = fc.tuple(agentId, agentId).filter(([a, b]) => a !== b)

// Intención que referencia a un Cliente (redactar o resumir).
const clientIntent = fc.constantFrom('draft', 'summary') as fc.Arbitrary<
  'draft' | 'summary'
>

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — Endpoint SSE chatStream (propiedades)', () => {
  // Feature: claude-chatbot-assistant, Property 14: Integridad del texto
  // transmitido y persistido — el texto reensamblado de los marcos SSE y el
  // contenido del mensaje del asistente persistido son ambos iguales a la
  // concatenación de los tokens emitidos.
  // Validates: Requirements 5.2, 5.4
  it('Property 14: el texto transmitido por SSE y el persistido coinciden con la concatenación de tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        nonEmptyContent,
        tokenSeq,
        async (ownerId, content, tokens) => {
          streamMock.mockReset()
          streamMock.mockImplementation(() => tokenStream(tokens))

          const Conversation = makeEntity()
          const Message = makeEntity()
          const Client = makeEntity()
          const Activity = makeEntity()
          const context = makeContext(
            { Conversation, Message, Client, Activity },
            ownerId
          )
          const res = makeRes()

          await chatStream({ body: { content, intent: 'chat' } }, res, context as any)

          const expected = tokens.join('')

          // Texto reensamblado de los marcos SSE transmitidos (Req 5.2).
          expect(tokensFromFrames(res._writes).join('')).toBe(expected)

          // Contenido del mensaje del asistente persistido (Req 5.4).
          const assistant = Message._rows().filter((m) => m.role === 'assistant')
          expect(assistant).toHaveLength(1)
          expect(assistant[0].content).toBe(expected)

          // El stream se completó con normalidad.
          expect(hasEvent(res._writes, 'done')).toBe(true)
          expect(res.ended).toBe(true)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 16: Rechazo de mensajes vacíos
  // del asistente — el contenido vacío o de solo espacios se rechaza con error
  // de validación (400), NO se invoca al Proveedor_Claude y nada se persiste.
  // Validates: Requirements 5.5
  it('Property 16: rechaza contenido vacío/espacios con 400, sin invocar al modelo ni persistir', async () => {
    await fc.assert(
      fc.asyncProperty(agentId, blankContent, async (ownerId, content) => {
        streamMock.mockReset()
        streamMock.mockImplementation(() => tokenStream(['no', 'debe', 'usarse']))

        const Conversation = makeEntity()
        const Message = makeEntity()
        const Client = makeEntity()
        const Activity = makeEntity()
        const context = makeContext(
          { Conversation, Message, Client, Activity },
          ownerId
        )
        const res = makeRes()

        await chatStream({ body: { content, intent: 'chat' } }, res, context as any)

        // Error de validación 400 (Req 5.5).
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody).toBeDefined()

        // El Proveedor_Claude NO se invoca.
        expect(streamMock).not.toHaveBeenCalled()

        // Nada se persiste: ni Conversacion, ni Mensaje.
        expect(Conversation._rows()).toHaveLength(0)
        expect(Message._rows()).toHaveLength(0)

        // No se abrió el stream SSE.
        expect(hasEvent(res._writes, 'token')).toBe(false)
      }),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 18: Rechazo de referencia a
  // cliente ajeno — una solicitud de redactar/resumir que referencia a un
  // Cliente de otro Agente se rechaza con error de autorización y NO se invoca
  // al Proveedor_Claude con sus datos.
  // Validates: Requirements 6.3
  it('Property 18: rechaza referencias a clientes ajenos con error de autorización, sin invocar al modelo', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctAgents,
        nonEmptyContent,
        clientIntent,
        async ([clientOwner, intruder], content, intent) => {
          streamMock.mockReset()
          streamMock.mockImplementation(() => tokenStream(['no', 'usar']))

          const Conversation = makeEntity()
          const Message = makeEntity()
          const Activity = makeEntity()
          // El Cliente pertenece a `clientOwner`, no al solicitante `intruder`.
          const Client = makeEntity()
          const foreignClient = await Client.create({
            data: { name: 'Ajeno', email: 'a@b.co', ownerId: clientOwner },
          })

          const context = makeContext(
            { Conversation, Message, Client, Activity },
            intruder
          )
          const res = makeRes()

          // Debe rechazarse con un error de autorización (HttpError 403).
          await expect(
            chatStream(
              { body: { content, intent, clientId: foreignClient.id } },
              res,
              context as any
            )
          ).rejects.toBeInstanceOf(HttpError)

          // El Proveedor_Claude NO se invoca con datos ajenos (Req 6.3).
          expect(streamMock).not.toHaveBeenCalled()

          // No se persiste mensaje alguno (la verificación ocurre antes).
          expect(Message._rows()).toHaveLength(0)
          expect(hasEvent(res._writes, 'token')).toBe(false)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 19: Creación única de
  // conversación en el primer mensaje — al enviar el primer mensaje (sin
  // conversationId) se crea exactamente UNA Conversacion asociada al Agente.
  // Validates: Requirements 7.1
  it('Property 19: el primer mensaje crea exactamente una Conversacion del Agente', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        nonEmptyContent,
        tokenSeq,
        async (ownerId, content, tokens) => {
          streamMock.mockReset()
          streamMock.mockImplementation(() => tokenStream(tokens))

          const Conversation = makeEntity()
          const Message = makeEntity()
          const Client = makeEntity()
          const Activity = makeEntity()
          const context = makeContext(
            { Conversation, Message, Client, Activity },
            ownerId
          )
          const res = makeRes()

          // Sin `conversationId`: es el primer mensaje de una conversación nueva.
          await chatStream({ body: { content, intent: 'chat' } }, res, context as any)

          const conversations = Conversation._rows()
          expect(conversations).toHaveLength(1)
          expect(conversations[0].ownerId).toBe(ownerId)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 20: Round-trip de persistencia
  // de mensaje — todo mensaje finalizado (del usuario y del asistente) se
  // relee con el mismo rol, contenido y conversación padre con los que se
  // persistió.
  // Validates: Requirements 7.2
  it('Property 20: los mensajes persistidos conservan rol, contenido y conversación padre', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        nonEmptyContent,
        tokenSeq,
        async (ownerId, content, tokens) => {
          streamMock.mockReset()
          streamMock.mockImplementation(() => tokenStream(tokens))

          const Conversation = makeEntity()
          const Message = makeEntity()
          const Client = makeEntity()
          const Activity = makeEntity()
          const context = makeContext(
            { Conversation, Message, Client, Activity },
            ownerId
          )
          const res = makeRes()

          await chatStream({ body: { content, intent: 'chat' } }, res, context as any)

          const conversationId = Conversation._rows()[0].id

          const userMsgs = Message._rows().filter((m) => m.role === 'user')
          const assistantMsgs = Message._rows().filter(
            (m) => m.role === 'assistant'
          )
          expect(userMsgs).toHaveLength(1)
          expect(assistantMsgs).toHaveLength(1)

          // Round-trip del mensaje del usuario (Req 7.2).
          expect(userMsgs[0].role).toBe('user')
          expect(userMsgs[0].content).toBe(content)
          expect(userMsgs[0].conversationId).toBe(conversationId)

          // Round-trip del mensaje del asistente (Req 7.2).
          expect(assistantMsgs[0].role).toBe('assistant')
          expect(assistantMsgs[0].content).toBe(tokens.join(''))
          expect(assistantMsgs[0].conversationId).toBe(conversationId)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Feature: claude-chatbot-assistant, Property 24: Preservación del mensaje
  // del usuario ante error del modelo — si el Proveedor_Claude falla, el
  // mensaje del Agente permanece persistido y se devuelve un indicador de error
  // (evento SSE `error`).
  // Validates: Requirements 9.1
  it('Property 24: ante error del modelo, conserva el mensaje del usuario y emite indicador de error', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentId,
        nonEmptyContent,
        nonEmptyTokenSeq,
        async (ownerId, content, tokens) => {
          streamMock.mockReset()
          // Emite algunos tokens y luego lanza a mitad del stream.
          streamMock.mockImplementation(() => failingStream(tokens))

          const Conversation = makeEntity()
          const Message = makeEntity()
          const Client = makeEntity()
          const Activity = makeEntity()
          const context = makeContext(
            { Conversation, Message, Client, Activity },
            ownerId
          )
          const res = makeRes()

          // El manejador captura el error internamente y finaliza el stream.
          await chatStream({ body: { content, intent: 'chat' } }, res, context as any)

          // Se emite un indicador de error a la Interfaz_Chat (Req 9.1).
          expect(hasEvent(res._writes, 'error')).toBe(true)
          expect(hasEvent(res._writes, 'done')).toBe(false)
          expect(res.ended).toBe(true)

          // El mensaje del usuario permanece persistido (Req 9.1).
          const userMsgs = Message._rows().filter((m) => m.role === 'user')
          expect(userMsgs).toHaveLength(1)
          expect(userMsgs[0].content).toBe(content)

          // No se persiste mensaje del asistente porque el stream no se completó.
          expect(Message._rows().filter((m) => m.role === 'assistant')).toHaveLength(0)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })
})
