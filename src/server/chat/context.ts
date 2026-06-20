// Constructor_Contexto (Tarea 8.1)
//
// Arma el arreglo de mensajes (`ChatMessage[]`) que se envía al Proveedor_Claude.
// Para una conversación normal ('chat') el contexto es simplemente el historial
// de la conversación, en orden. Para las acciones de redactar ('draft') o
// resumir ('summary') se antepone un preámbulo con los datos del Cliente; en el
// caso de resumen se incluyen además sus Registro_Actividad.
//
// La verificación de propiedad del Cliente (Requisito 6.3) se realiza en el
// llamador (endpoint SSE) antes de pasar `client`/`activities` aquí: este módulo
// asume que los datos recibidos ya pertenecen al Agente solicitante.
//
// Requisitos:
// - 5.1: El mensaje y el contexto de la conversación se envían al Proveedor_Claude
//        (el historial se incluye, en orden, seguido del nuevo mensaje).
// - 6.1: Al redactar, los datos del Cliente se incluyen en el contexto.
// - 6.2: Al resumir, se incluyen los campos del Cliente y sus actividades.

import type { Client, Activity } from 'wasp/entities'
import type { ChatMessage } from './claudeProvider.js'

/**
 * Representación serializable de un Cliente.
 *
 * Extrae los campos de dominio relevantes del Cliente, dejando fuera detalles
 * internos de persistencia. Se usa tanto para construir el preámbulo del
 * contexto del asistente como para las integraciones (p. ej. el cuerpo del
 * webhook de salida de Zapier).
 */
export function serializeClient(client: Client) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    company: client.company,
    status: client.status,
    notes: client.notes,
  }
}

/**
 * Construye el arreglo de mensajes para el Proveedor_Claude.
 *
 * @param opts.history    Mensajes previos de la conversación, en orden cronológico.
 * @param opts.intent     Tipo de solicitud: 'chat', 'draft' o 'summary'.
 * @param opts.client     Cliente de referencia (presente para 'draft'/'summary').
 * @param opts.activities Actividades del Cliente (solo se usan para 'summary').
 * @returns El preámbulo (cuando hay datos de Cliente) seguido del historial,
 *          de modo que los mensajes previos quedan, en orden, antes del nuevo
 *          mensaje (Requisito 5.1).
 */
export function buildContext(opts: {
  history: ChatMessage[]
  intent: 'chat' | 'draft' | 'summary'
  client?: Client
  activities?: Activity[]
}): ChatMessage[] {
  const system: string[] = []

  // Datos del Cliente para redactar o resumir (Requisitos 6.1, 6.2).
  if (opts.client) {
    system.push(`Datos del cliente: ${JSON.stringify(serializeClient(opts.client))}`)
  }

  // Registro de actividad solo en el caso de resumen (Requisito 6.2).
  if (opts.intent === 'summary' && opts.activities) {
    system.push(
      `Actividad: ${opts.activities
        .map((a) => `${a.createdAt}: ${a.content}`)
        .join('\n')}`
    )
  }

  const preamble: ChatMessage[] = system.length
    ? [{ role: 'user', content: system.join('\n\n') }]
    : []

  // El historial se preserva en orden a continuación del preámbulo (Req 5.1).
  return [...preamble, ...opts.history]
}
