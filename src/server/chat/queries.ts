// Consultas y utilidades de recuperación de conversaciones (Tarea 9.1).
//
// Implementa la persistencia y recuperación de conversaciones del asistente con
// aislamiento por propietario:
//
// - `getConversations`: lista las conversaciones del Agente autenticado,
//   ordenadas por actividad más reciente (`updatedAt` descendente).
// - `getMessages`: devuelve los mensajes de una conversación propia, tras
//   verificar la propiedad, en orden cronológico no decreciente (`createdAt`
//   ascendente).
//
// Utilidades para el endpoint de stream (`server/chat/stream.ts`, Tarea 10.1):
// - `getConv`: recupera el registro de Conversacion para verificar su propiedad.
// - `loadHistory`: carga el historial de mensajes como `ChatMessage[]` listo
//   para el Constructor_Contexto / Proveedor_Claude.
//
// Requisitos:
// - 7.3: Las conversaciones del Agente se recuperan ordenadas por actividad reciente.
// - 7.4: Los mensajes de una conversación se cargan en orden cronológico.
// - 7.5: Aislamiento por propietario en la recuperación de conversaciones.

import { requireUser, requireOwnership } from '../auth/ownership.js'
import type { ChatMessage } from './claudeProvider.js'

/** Forma mínima de una Conversacion persistida para las verificaciones de propiedad. */
type OwnedConversation = { id: number; ownerId: number }

/**
 * Lista las Conversacion del Agente autenticado, ordenadas por actividad más
 * reciente (Requisitos 7.3, 7.5).
 *
 * @returns Las Conversacion cuyo propietario es el Agente, en orden no creciente
 *          según `updatedAt`.
 */
export const getConversations = async (_args: unknown, context: any) => {
  const ownerId = requireUser(context)
  return context.entities.Conversation.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Recupera los Mensaje de una Conversacion propia del Agente, en orden
 * cronológico no decreciente (Requisitos 7.4, 7.5).
 *
 * Antes de leer los mensajes verifica que la Conversacion exista y pertenezca al
 * Agente; en caso contrario lanza HttpError 403.
 *
 * @param args.conversationId Identificador de la Conversacion a consultar.
 * @throws HttpError 403 si la Conversacion no existe o pertenece a otro Agente.
 */
export const getMessages = async (
  { conversationId }: { conversationId: number },
  context: any
) => {
  const ownerId = requireUser(context)
  const conversation = await getConv(conversationId, context)
  await requireOwnership(conversation as OwnedConversation | null, ownerId)

  return context.entities.Message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * Utilidad para el endpoint de stream: recupera el registro de Conversacion por
 * su identificador (sin verificar propiedad). El llamador debe aplicar
 * `requireOwnership` para garantizar el aislamiento (Requisito 7.5).
 *
 * @param conversationId Identificador de la Conversacion.
 * @returns El registro de Conversacion o `null` si no existe.
 */
export const getConv = async (conversationId: number, context: any) => {
  return context.entities.Conversation.findUnique({
    where: { id: conversationId },
  })
}

/**
 * Utilidad para el endpoint de stream: carga el historial de Mensaje de una
 * Conversacion como `ChatMessage[]` en orden cronológico no decreciente, listo
 * para el Constructor_Contexto / Proveedor_Claude (Requisito 7.4).
 *
 * @param conversationId Identificador de la Conversacion.
 * @returns El historial de mensajes con `role` y `content`, en orden ascendente
 *          por `createdAt`.
 */
export const loadHistory = async (
  conversationId: number,
  context: any
): Promise<ChatMessage[]> => {
  const messages = await context.entities.Message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  })
  return messages.map((m: { role: ChatMessage['role']; content: string }) => ({
    role: m.role,
    content: m.content,
  }))
}
