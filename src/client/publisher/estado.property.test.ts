// Prueba basada en propiedades para las etiquetas de estado en español del
// Publicador de Vídeos IA (Tarea 9.2).
//
// Feature: publicador-videos-ia, Property 15: Etiqueta de estado en español
// Validates: Requirements 9.2
//
// Para cada valor de Estado_Publicacion ('pendiente', 'enviado', 'error',
// 'manual'), el catálogo de cadenas en español `es` debe ofrecer una etiqueta
// no vacía en `es.publisher.status`, de modo que la interfaz siempre muestre el
// estado traducido al español.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { es } from '../i18n/es'

/** Los cuatro estados posibles de un contenido por plataforma. */
const ESTADOS = ['pendiente', 'enviado', 'error', 'manual'] as const
type Estado = (typeof ESTADOS)[number]

describe('es.publisher.status — etiqueta de estado en español (Property 15)', () => {
  it('cada Estado_Publicacion tiene una etiqueta no vacía en español', () => {
    fc.assert(
      fc.property(fc.constantFrom<Estado>(...ESTADOS), (estado) => {
        const etiqueta = es.publisher.status[estado]
        // La etiqueta debe ser una cadena con contenido visible (no vacía).
        expect(typeof etiqueta).toBe('string')
        expect(etiqueta.trim().length).toBeGreaterThan(0)
      }),
      { numRuns: 100 }
    )
  })

  // Verificación explícita por ejemplo de los cuatro estados conocidos.
  it.each(ESTADOS)('el estado "%s" tiene etiqueta no vacía', (estado) => {
    const etiqueta = es.publisher.status[estado]
    expect(etiqueta.trim().length).toBeGreaterThan(0)
  })
})
