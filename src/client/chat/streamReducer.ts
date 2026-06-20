// Lógica pura del streaming del asistente (extraída de `InterfazChat.tsx`).
//
// Este módulo no importa nada de `wasp/*` ni de React, de modo que puede
// probarse de forma aislada (Tarea 14.6, Property 15) en un entorno Node con
// Vitest + fast-check, sin depender del SDK generado por Wasp.
//
// Contiene:
//   - El reducer de acumulación incremental de tokens (Requisito 5.3).
//   - El parseo de tramas SSE (`event: token` / `event: done` / `event: error`).

/** Tipos de eventos SSE emitidos por el endpoint `chatStream`. */
export type ChatStreamEvent =
  | { type: 'token'; data: string }
  | { type: 'done'; data: { conversationId: number } }
  | { type: 'error'; data: { message: string } }

// --- Reducer de acumulación incremental de tokens (Requisito 5.3) ----------

export type StreamState = { text: string }
export type StreamAction =
  | { type: 'reset' }
  | { type: 'append'; chunk: string }

/**
 * Reducer de acumulación incremental: tras procesar cada fragmento el estado de
 * texto es igual a la concatenación de todos los fragmentos recibidos hasta ese
 * momento (Requisito 5.3, Property 15).
 */
export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'reset':
      return { text: '' }
    case 'append':
      return { text: state.text + action.chunk }
    default:
      return state
  }
}

/** Estado inicial del acumulador de streaming. */
export const initialStreamState: StreamState = { text: '' }

// --- Parseo de tramas SSE ---------------------------------------------------

/**
 * Convierte un bloque de texto SSE (líneas `event:` y `data:` separadas por una
 * línea en blanco) en un evento tipado, o `null` si no se reconoce.
 */
export function parseSseFrame(frame: string): ChatStreamEvent | null {
  let eventName = 'message'
  const dataLines: string[] = []

  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
    }
  }

  const dataRaw = dataLines.join('\n')

  if (eventName === 'token') {
    // El dato es una cadena JSON (el token con sus posibles espacios/saltos).
    try {
      return { type: 'token', data: JSON.parse(dataRaw) as string }
    } catch {
      return { type: 'token', data: dataRaw }
    }
  }
  if (eventName === 'done') {
    try {
      return { type: 'done', data: JSON.parse(dataRaw) as { conversationId: number } }
    } catch {
      return { type: 'done', data: { conversationId: NaN } }
    }
  }
  if (eventName === 'error') {
    try {
      return { type: 'error', data: JSON.parse(dataRaw) as { message: string } }
    } catch {
      return { type: 'error', data: { message: dataRaw } }
    }
  }
  return null
}
