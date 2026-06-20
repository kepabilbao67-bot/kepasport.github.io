// Pruebas basadas en propiedades para el endpoint de entrada de Zapier (Tarea 13.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre las propiedades de diseño 27, 28 y 29 con fast-check (mínimo 100
// iteraciones por propiedad). Las pruebas ejercitan la lógica REAL del
// manejador `zapierInbound` (`zapierInbound.ts`), el `config` real y un cliente
// Prisma en memoria (`makeEntity`/`makeContext` de `src/test/mockContext.ts`).
//
// El manejador es un endpoint Express sin sesión de Wasp; por ello se construye
// un `req` mínimo (con `body` y `get(headerName)` para la cabecera
// `X-Zapier-Token`) y un `res` que captura `status()`/`json()`. El token
// esperado se fija en `process.env.ZAPIER_INBOUND_TOKEN` (se guarda y restaura)
// para que `config.zapierToken()` devuelva un valor conocido; el token provisto
// se genera de modo que pueda coincidir o no.
//
//   - Property 27: token válido + nombre/correo válidos → 201 y Cliente persistido.
//   - Property 28: token != configurado → 401 y ningún Cliente creado.
//   - Property 29: falta nombre o correo → 400 y ningún Cliente creado.
//
// **Validates: Requirements 11.1, 11.2, 11.3**

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { zapierInbound } from './zapierInbound.js'
import { serializeClient } from '../chat/context.js'
import { makeEntity, makeContext } from '../../test/mockContext.js'

const NUM_RUNS = 100

// Token de integración "configurado" para las pruebas.
const CONFIGURED_TOKEN = 'token-de-integracion-secreto-123'

// --- Ayudantes de mock de Express -----------------------------------------

/** Construye un `req` Express mínimo con cuerpo y cabeceras. */
function makeReq(opts: {
  body: Record<string, unknown>
  headerToken?: string
}) {
  const headers: Record<string, string> = {}
  if (opts.headerToken !== undefined) {
    headers['x-zapier-token'] = opts.headerToken
  }
  return {
    body: opts.body,
    headers,
    get(name: string): string | undefined {
      return headers[name.toLowerCase()]
    },
  }
}

/** Construye un `res` Express que captura el código de estado y el cuerpo. */
function makeRes() {
  const captured: { statusCode?: number; body?: unknown } = {}
  const res = {
    status(code: number) {
      captured.statusCode = code
      return res
    },
    json(payload: unknown) {
      captured.body = payload
      return res
    },
  }
  return { res, captured }
}

// --- Generadores inteligentes (restringidos al espacio de entrada) ----------

// Texto no vacío tras recortar espacios (válido para nombre/correo según Req 11.3).
const nonBlankText = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)

// Texto en blanco: cadena vacía o solo espacios/tabs/saltos de línea.
const blankText = fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 5 })

// Campo de texto opcional (puede omitirse → undefined).
const optionalText = fc.option(fc.string({ maxLength: 30 }), { nil: undefined })

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — endpoint de entrada de Zapier (propiedades)', () => {
  let originalToken: string | undefined

  beforeEach(() => {
    originalToken = process.env.ZAPIER_INBOUND_TOKEN
    process.env.ZAPIER_INBOUND_TOKEN = CONFIGURED_TOKEN
  })

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ZAPIER_INBOUND_TOKEN
    } else {
      process.env.ZAPIER_INBOUND_TOKEN = originalToken
    }
  })

  // Property 27: Creación de cliente desde entrada de Zapier válida
  // Validates: Requirements 11.1
  it('Property 27: token válido + nombre/correo válidos → 201 y Cliente persistido con esos datos', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonBlankText,
        nonBlankText,
        optionalText,
        optionalText,
        // El token válido puede llegar por cabecera o por el cuerpo.
        fc.boolean(),
        async (name, email, phone, company, tokenInHeader) => {
          const clients = makeEntity<Record<string, any>>([])
          const context = makeContext({ Client: clients })

          const body: Record<string, unknown> = { name, email }
          if (phone !== undefined) body.phone = phone
          if (company !== undefined) body.company = company
          if (!tokenInHeader) body.token = CONFIGURED_TOKEN

          const req = makeReq({
            body,
            headerToken: tokenInHeader ? CONFIGURED_TOKEN : undefined,
          })
          const { res, captured } = makeRes()

          await zapierInbound(req, res, context)

          // Req 11.1: respuesta 201.
          expect(captured.statusCode).toBe(201)

          // Se persistió exactamente un Cliente con los datos recortados.
          const rows = clients._rows()
          expect(rows).toHaveLength(1)
          expect(rows[0].name).toBe(name.trim())
          expect(rows[0].email).toBe(email.trim())

          // El cuerpo de respuesta es la representación serializable del Cliente.
          expect(captured.body).toEqual(serializeClient(rows[0] as any))
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 28: Autorización del endpoint de entrada
  // Validates: Requirements 11.2
  it('Property 28: token distinto del configurado → 401 y ningún Cliente creado', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Token provisto que NO coincide con el configurado.
        fc.string({ maxLength: 40 }).filter((t) => t !== CONFIGURED_TOKEN),
        nonBlankText,
        nonBlankText,
        fc.boolean(),
        async (wrongToken, name, email, tokenInHeader) => {
          const clients = makeEntity<Record<string, any>>([])
          const context = makeContext({ Client: clients })

          // Datos por lo demás válidos, para aislar el efecto del token.
          const body: Record<string, unknown> = { name, email }
          if (!tokenInHeader) body.token = wrongToken

          const req = makeReq({
            body,
            headerToken: tokenInHeader ? wrongToken : undefined,
          })
          const { res, captured } = makeRes()

          await zapierInbound(req, res, context)

          // Req 11.2: rechazo con 401.
          expect(captured.statusCode).toBe(401)

          // No se creó ningún Cliente.
          expect(clients._rows()).toHaveLength(0)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Property 29: Validación del endpoint de entrada
  // Validates: Requirements 11.3
  it('Property 29: falta nombre o correo → 400 y ningún Cliente creado', async () => {
    // Genera un cuerpo con token válido pero al que le falta (u omite, o deja en
    // blanco) el nombre o el correo electrónico.
    const missingFieldBody = fc
      .record({
        // 'omit' = campo ausente; 'blank' = presente pero en blanco; 'valid' = válido.
        nameMode: fc.constantFrom('omit', 'blank', 'valid'),
        emailMode: fc.constantFrom('omit', 'blank', 'valid'),
        nameValue: nonBlankText,
        emailValue: nonBlankText,
        nameBlank: blankText,
        emailBlank: blankText,
      })
      // Al menos uno de los dos campos debe faltar o estar en blanco.
      .filter((r) => r.nameMode !== 'valid' || r.emailMode !== 'valid')

    await fc.assert(
      fc.asyncProperty(missingFieldBody, async (r) => {
        const clients = makeEntity<Record<string, any>>([])
        const context = makeContext({ Client: clients })

        const body: Record<string, unknown> = { token: CONFIGURED_TOKEN }
        if (r.nameMode === 'valid') body.name = r.nameValue
        else if (r.nameMode === 'blank') body.name = r.nameBlank
        if (r.emailMode === 'valid') body.email = r.emailValue
        else if (r.emailMode === 'blank') body.email = r.emailBlank

        const req = makeReq({ body, headerToken: CONFIGURED_TOKEN })
        const { res, captured } = makeRes()

        await zapierInbound(req, res, context)

        // Req 11.3: error de validación 400.
        expect(captured.statusCode).toBe(400)

        // No se creó ningún Cliente.
        expect(clients._rows()).toHaveLength(0)
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
