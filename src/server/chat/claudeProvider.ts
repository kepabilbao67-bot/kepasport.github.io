// Proveedor_Claude
//
// Capa de integración con el SDK de Anthropic (`@anthropic-ai/sdk`). Encapsula
// la selección del modelo, la lectura de la clave de API y el manejo de errores
// de configuración. Expone `streamCompletion`, un async generator que emite los
// tokens de texto de la respuesta del modelo a medida que se reciben.
//
// Requisitos:
// - 5.1: El mensaje y el contexto de la conversación se envían al Proveedor_Claude.
// - 5.2: Los tokens de la respuesta se transmiten a medida que se reciben.
// - 8.5: Si la clave de API falta, se devuelve un error de configuración (500) y
//        NO se invoca al modelo.

import Anthropic from '@anthropic-ai/sdk'
import { HttpError } from 'wasp/server'
import { config } from '../config.js'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function* streamCompletion(
  messages: ChatMessage[]
): AsyncGenerator<string> {
  // Guarda por ausencia de clave de API: se comprueba ANTES de construir el
  // cliente o invocar al modelo (Requisito 8.5).
  const apiKey = config.anthropicApiKey()
  if (!apiKey) {
    throw new HttpError(500, 'Falta la configuración de la clave de API')
  }

  const client = new Anthropic({ apiKey })

  // El modelo se toma de la configuración (por defecto `claude-3-5-sonnet`).
  const stream = await client.messages.stream({
    model: config.claudeModel(),
    max_tokens: 1024,
    messages,
  })

  // Reenviar cada delta de texto como un token individual (Requisito 5.2).
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text
    }
  }
}
