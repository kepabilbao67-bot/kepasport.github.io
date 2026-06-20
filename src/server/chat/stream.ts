// Endpoint SSE del asistente: `chatStream` (Tarea 10.1)
//
// Maneja el flujo de chat con streaming token a token vía Server-Sent Events
// (SSE). Es un endpoint `api` personalizado de Wasp (declarado en `main.wasp`)
// con `auth: true`, por lo que recibe `(req, res, context)` y `context.user`.
//
// Flujo (ver design.md → "Endpoint SSE `chatStream`"):
//  1. Verifica la sesión del Agente (401 si no hay usuario) — Req 1.2.
//  2. Lee `{ conversationId?, content, intent, clientId? }` del cuerpo.
//  3. Rechaza contenido vacío o solo espacios ANTES de invocar al modelo — Req 5.5.
//  4. Resuelve la Conversacion propia o la crea en el primer mensaje — Req 7.1, 7.5.
//  5. Para 'draft'/'summary' con `clientId`, verifica la propiedad del Cliente
//     (Req 6.3) y carga sus actividades cuando la intención es 'summary'.
//  6. Persiste el Mensaje del usuario ANTES de invocar al modelo — Req 9.1.
//  7. Abre el stream SSE, arma el contexto y reenvía cada token como
//     `event: token` — Req 5.2.
//  8. Al completarse, persiste el Mensaje del asistente y emite `event: done`
//     — Req 5.4, 7.2.
//  9. Ante error, emite `event: error` conservando el mensaje del usuario
//     persistido; siempre finaliza el stream en `finally` — Req 9.1, 9.2.

import { requireUser, requireOwnership } from '../auth/ownership.js'
import { streamCompletion } from './claudeProvider.js'
import { buildContext } from './context.js'
import { getConv, loadHistory } from './queries.js'

/** Forma mínima de una Conversacion persistida para la verificación de propiedad. */
type OwnedConversation = { id: number; ownerId: number }

/** Tipos de solicitud admitidos por el asistente. */
type ChatIntent = 'chat' | 'draft' | 'summary'

/**
 * Manejador del endpoint SSE `chatStream`.
 *
 * @param req     Solicitud HTTP de Express; el cuerpo contiene
 *                `{ conversationId?, content, intent, clientId? }`.
 * @param res     Respuesta HTTP de Express usada para el stream SSE.
 * @param context Contexto de Wasp con `user` y `entities`.
 */
export const chatStream = async (req: any, res: any, context: any) => {
  // Req 1.2: solo Agentes autenticados.
  const ownerId = requireUser(context)

  const {
    conversationId,
    content,
    intent = 'chat',
    clientId,
  }: {
    conversationId?: number
    content?: string
    intent?: ChatIntent
    clientId?: number
  } = req.body ?? {}

  // Req 5.5: rechazar mensajes vacíos o de solo espacios ANTES de invocar al
  // modelo. No se crea conversación ni se persiste nada en este caso.
  if (!content?.trim()) {
    res.status(400).json({ error: 'El mensaje no puede estar vacío' })
    return
  }

  // Req 7.1, 7.5: resolver la Conversacion propia o crearla en el primer mensaje.
  const conversation = conversationId
    ? await requireOwnership(
        (await getConv(conversationId, context)) as OwnedConversation | null,
        ownerId
      )
    : await context.entities.Conversation.create({ data: { ownerId } })

  // Req 6.3: verificación de propiedad del Cliente para redactar/resumir.
  // Para 'summary' se cargan además sus actividades en orden cronológico.
  let client: any
  let activities: any
  if (clientId) {
    const owned = await getClient({ id: clientId }, context)
    client = owned
    if (intent === 'summary') activities = owned.activities
  }

  // Req 9.1: persistir el Mensaje del usuario ANTES de invocar al modelo, de
  // modo que se conserve aunque el modelo falle más adelante.
  await context.entities.Message.create({
    data: { conversationId: conversation.id, role: 'user', content },
  })

  // Cabeceras SSE.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  // Historial + preámbulo de Cliente/Actividad (Req 5.1, 6.1, 6.2).
  const history = await loadHistory(conversation.id, context)
  const messages = buildContext({ history, intent, client, activities })

  let acc = ''
  try {
    // Req 5.2: reenviar cada token a medida que se recibe.
    for await (const token of streamCompletion(messages)) {
      acc += token
      res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`)
    }

    // Req 5.4, 7.2: persistir el Mensaje del asistente al completar el stream.
    await context.entities.Message.create({
      data: { conversationId: conversation.id, role: 'assistant', content: acc },
    })

    res.write(
      `event: done\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`
    )
  } catch (err) {
    // Req 9.1, 9.2: informar del error sin revertir el mensaje del usuario, que
    // ya quedó persistido antes de invocar al modelo.
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: 'El asistente no pudo responder' })}\n\n`
    )
  } finally {
    // Garantizar siempre el cierre del stream.
    res.end()
  }
}

/**
 * Recupera un Cliente propio del Agente verificando la propiedad (Req 6.3) y
 * carga sus Registro_Actividad en orden cronológico para el caso de resumen
 * (Req 6.2).
 *
 * Se define localmente para mantener el endpoint autocontenido: replica el
 * aislamiento por propietario aplicado por la consulta `getClient`.
 *
 * @throws HttpError 403 si el Cliente no existe o pertenece a otro Agente.
 */
async function getClient(
  { id }: { id: number },
  context: any
): Promise<{ id: number; ownerId: number; activities: any[] } & Record<string, unknown>> {
  const ownerId = requireUser(context)
  const record = await context.entities.Client.findUnique({ where: { id } })
  const owned = await requireOwnership(
    record as { id: number; ownerId: number } | null,
    ownerId
  )
  const activities = await context.entities.Activity.findMany({
    where: { clientId: id },
    orderBy: { createdAt: 'asc' },
  })
  return { ...(owned as object), activities } as any
}
