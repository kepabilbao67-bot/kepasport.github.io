// Pruebas basadas en propiedades del Gestor de Configuración.
//
// Feature: claude-chatbot-assistant, Property 22: Selección del modelo desde la configuración
// **Validates: Requirements 8.1, 8.2**
//
// Propiedad 22: para todo valor presente y no vacío en la variable de entorno
// CLAUDE_MODEL, `config.claudeModel()` devuelve ese mismo valor; y cuando la
// variable está ausente, vacía o compuesta solo por espacios en blanco,
// devuelve el valor por defecto `claude-3-5-sonnet`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { config } from './config'

const DEFAULT_MODEL = 'claude-3-5-sonnet'

describe('Feature: claude-chatbot-assistant, Property 22: Selección del modelo desde la configuración', () => {
  let original: string | undefined

  beforeEach(() => {
    // Guardar el valor original para restaurarlo tras cada caso.
    original = process.env.CLAUDE_MODEL
  })

  afterEach(() => {
    // Restaurar el entorno para no filtrar estado entre pruebas.
    if (original === undefined) {
      delete process.env.CLAUDE_MODEL
    } else {
      process.env.CLAUDE_MODEL = original
    }
  })

  it('devuelve el valor configurado cuando CLAUDE_MODEL está presente y no vacío', () => {
    fc.assert(
      fc.property(
        // Identificadores de modelo arbitrarios y "no vacíos" en el sentido de
        // la configuración: con contenido tras recortar espacios. Se excluye el
        // byte nulo (no válido en variables de entorno) y los espacios
        // circundantes, ya que una variable solo de espacios se trata como "sin
        // configurar" (recurre al valor por defecto, ver caso complementario).
        fc
          .string({ minLength: 1 })
          .filter((s) => !s.includes('\u0000') && s === s.trim() && s.length > 0),
        (model) => {
          process.env.CLAUDE_MODEL = model
          expect(config.claudeModel()).toBe(model)
        }
      ),
      { numRuns: 100 }
    )
  })

  it("devuelve 'claude-3-5-sonnet' cuando CLAUDE_MODEL está ausente, vacía o solo espacios", () => {
    fc.assert(
      fc.property(
        // Tres formas de "sin modelo configurado": ausente (undefined), vacía
        // ('') o compuesta solo por espacios en blanco.
        fc.oneof(
          fc.constant<string | undefined>(undefined),
          fc.constant<string | undefined>(''),
          fc
            .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 6 })
            .map((chars) => chars.join(''))
        ),
        (value) => {
          if (value === undefined) {
            delete process.env.CLAUDE_MODEL
          } else {
            process.env.CLAUDE_MODEL = value
          }
          expect(config.claudeModel()).toBe(DEFAULT_MODEL)
        }
      ),
      { numRuns: 100 }
    )
  })
})
