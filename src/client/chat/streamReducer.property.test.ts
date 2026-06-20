// Prueba basada en propiedades para la acumulación incremental de la
// Interfaz_Chat (Tarea 14.6).
//
// Feature: claude-chatbot-assistant, Property 15: Acumulación incremental en la interfaz
// Validates: Requirements 5.3
//
// Para toda secuencia de fragmentos recibidos, el estado de texto mostrado por
// la Interfaz_Chat tras procesar cada fragmento debe ser igual a la
// concatenación de todos los fragmentos recibidos hasta ese momento.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  streamReducer,
  initialStreamState,
  parseSseFrame,
  type StreamState,
} from './streamReducer'

describe('streamReducer — acumulación incremental (Property 15)', () => {
  it('tras cada fragmento, el estado es la concatenación de los fragmentos recibidos hasta ese momento', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (fragmentos) => {
        let state: StreamState = initialStreamState
        let esperado = ''

        for (const fragmento of fragmentos) {
          state = streamReducer(state, { type: 'append', chunk: fragmento })
          esperado += fragmento
          // Invariante en cada paso: el estado iguala la concatenación parcial.
          expect(state.text).toBe(esperado)
        }

        // Al final, el estado es la concatenación completa de todos los fragmentos.
        expect(state.text).toBe(fragmentos.join(''))
      }),
      { numRuns: 200 }
    )
  })

  it('la acción `reset` vuelve el estado a la cadena vacía', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (fragmentos) => {
        let state: StreamState = initialStreamState
        for (const fragmento of fragmentos) {
          state = streamReducer(state, { type: 'append', chunk: fragmento })
        }
        state = streamReducer(state, { type: 'reset' })
        expect(state.text).toBe('')
      }),
      { numRuns: 100 }
    )
  })

  it('reconstruye el texto a partir de tramas SSE `token` igual que la concatenación de los tokens', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (tokens) => {
        // Emula las tramas SSE `event: token` que produce el backend.
        let state: StreamState = initialStreamState
        for (const token of tokens) {
          const frame = `event: token\ndata: ${JSON.stringify(token)}`
          const evento = parseSseFrame(frame)
          expect(evento?.type).toBe('token')
          if (evento?.type === 'token') {
            state = streamReducer(state, { type: 'append', chunk: evento.data })
          }
        }
        expect(state.text).toBe(tokens.join(''))
      }),
      { numRuns: 200 }
    )
  })
})
