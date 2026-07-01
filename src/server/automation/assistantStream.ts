// Endpoint SSE del asistente de automatización (integrado en DetallePublicacion)
//
// Maneja preguntas sobre n8n/Make/Zapier/APIs de redes sociales con streaming
// token a token vía Server-Sent Events (SSE). Es un endpoint `api` personalizado
// de Wasp (declarado en `main.wasp`) con `auth: true`.
//
// Flujo:
//  1. Verifica la sesión del usuario (401 si no hay sesión).
//  2. Lee `{ question, postContext }` del cuerpo.
//  3. Rechaza preguntas vacías (400).
//  4. Comprueba la clave de API (500 si falta, sin invocar al modelo).
//  5. Construye un system prompt en español con contexto de la publicación.
//  6. Abre el stream SSE y reenvía tokens como `event: token`.
//  7. Emite `event: done` al completar, `event: error` ante fallos.

import { requireUser } from '../auth/ownership.js'
import { streamCompletion } from '../chat/claudeProvider.js'
import { config } from '../config.js'

/** Contexto opcional de la publicación para enriquecer el system prompt. */
type PostContext = {
  videoUrl?: string
  brief?: string
  platform?: string
  status?: string
}

/**
 * Construye el mensaje completo que se envía al modelo, inyectando el system
 * prompt como preámbulo de la pregunta del usuario (patrón de usuario único).
 */
function buildFullPrompt(systemPrompt: string, question: string): string {
  return `${systemPrompt}\n\n---\n\nPregunta del usuario: ${question}`
}

/**
 * Construye el system prompt en español para el asistente de automatización.
 * Si se proporciona contexto de la publicación, se añaden líneas relevantes.
 */
function buildSystemPrompt(postContext?: PostContext): string {
  const base =
    'Eres un asistente especializado en automatización (n8n, Make, Zapier, ' +
    'webhooks, APIs de LinkedIn, YouTube, Instagram, X y TikTok). ' +
    'Ayudas al usuario a conectar y automatizar la publicación de sus vídeos ' +
    'en redes sociales. Responde siempre en español de forma clara y concisa.'

  if (!postContext) return base

  const lines: string[] = [base, '']
  lines.push('Contexto de la publicación actual:')

  if (postContext.videoUrl) {
    lines.push(`- URL del vídeo: ${postContext.videoUrl}`)
  }
  if (postContext.brief) {
    lines.push(`- Tema / resumen: ${postContext.brief}`)
  }
  if (postContext.platform) {
    lines.push(`- Plataforma principal: ${postContext.platform}`)
  }
  if (postContext.status) {
    lines.push(`- Estado de publicación: ${postContext.status}`)
  }

  return lines.join('\n')
}

/**
 * Manejador del endpoint SSE `automationAssistantStream`.
 *
 * @param req     Solicitud HTTP de Express; el cuerpo contiene
 *                `{ question, postContext? }`.
 * @param res     Respuesta HTTP de Express usada para el stream SSE.
 * @param context Contexto de Wasp con `user`.
 */
export const automationAssistantStream = async (
  req: any,
  res: any,
  context: any
) => {
  // Verificar sesión (401 si no autenticado).
  requireUser(context)

  const {
    question,
    postContext,
  }: { question?: string; postContext?: PostContext } = req.body ?? {}

  // Rechazar preguntas vacías antes de invocar al modelo.
  if (!question?.trim()) {
    res.status(400).json({ error: 'La pregunta no puede estar vacía' })
    return
  }

  // Comprobar clave de API antes de invocar al modelo (no llegar al proveedor).
  if (!config.anthropicApiKey()) {
    res
      .status(500)
      .json({ error: 'Falta la configuración de la clave de API' })
    return
  }

  const systemPrompt = buildSystemPrompt(postContext)
  const fullPrompt = buildFullPrompt(systemPrompt, question.trim())

  // Cabeceras SSE.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  try {
    for await (const token of streamCompletion([
      { role: 'user', content: fullPrompt },
    ])) {
      res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`)
    }

    res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`)
  } catch (err) {
    res.write(
      `event: error\ndata: ${JSON.stringify({
        message: 'El asistente no pudo responder. Inténtalo de nuevo.',
      })}\n\n`
    )
  } finally {
    res.end()
  }
}
