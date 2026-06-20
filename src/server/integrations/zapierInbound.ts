// Capa_Zapier — entrada (Tarea 13.1)
//
// Endpoint de entrada de Zapier (`Endpoint_Zapier_Entrada`): permite que un
// sistema externo (Zapier) cree Clientes en el CRM a través de un endpoint REST
// seguro, sin sesión de Wasp. Es un endpoint `api` personalizado declarado en
// `main.wasp` con `auth: false`; la autenticación se realiza mediante un token
// secreto (`Token_Integracion`) en lugar de la sesión del Agente.
//
// Flujo (ver design.md → "Endpoint de entrada de Zapier"):
//  1. Lee el `Token_Integracion` de la cabecera `X-Zapier-Token` o de
//     `req.body.token`; si no coincide con `config.zapierToken()`, responde 401
//     — Req 11.2.
//  2. Valida que `name` y `email` estén presentes y no vacíos; si falta alguno,
//     responde 400 — Req 11.3.
//  3. Crea y persiste el Cliente mediante Prisma y responde 201 con su
//     representación serializable — Req 11.1.
//
// El `Token_Integracion` se lee desde `.env` en tiempo de ejecución a través de
// `config.zapierToken()` — Req 11.4.

import { config } from '../config.js'
import { serializeClient } from '../chat/context.js'

/** Campos aceptados en el cuerpo de la solicitud de entrada de Zapier. */
type ZapierInboundBody = {
  token?: string
  name?: string
  email?: string
  phone?: string
  company?: string
  status?: string
  notes?: string
  ownerId?: number
}

/**
 * Manejador del endpoint `api` `zapierInbound`.
 *
 * @param req     Solicitud HTTP de Express; el token puede venir en la cabecera
 *                `X-Zapier-Token` o en `req.body.token`, y los datos del Cliente
 *                en el cuerpo.
 * @param res     Respuesta HTTP de Express.
 * @param context Contexto de Wasp con `entities` (incluye `Client`).
 */
export const zapierInbound = async (req: any, res: any, context: any) => {
  const body: ZapierInboundBody = req.body ?? {}

  // Req 11.2: autorización por token. El token puede llegar por cabecera
  // (`X-Zapier-Token`) o en el cuerpo (`token`). Si no coincide con el
  // configurado, se rechaza la solicitud con 401.
  const headerToken = req.get?.('X-Zapier-Token') ?? req.headers?.['x-zapier-token']
  const provided = headerToken ?? body.token
  const expected = config.zapierToken() // Req 11.4: leído de .env en tiempo de ejecución
  if (!expected || provided !== expected) {
    res.status(401).json({ error: 'Token de integración no válido' })
    return
  }

  // Req 11.3: validar que nombre y correo estén presentes y no vacíos.
  if (!body.name?.trim() || !body.email?.trim()) {
    res
      .status(400)
      .json({ error: 'El nombre y el correo electrónico son obligatorios' })
    return
  }

  // Req 11.1: crear y persistir el Cliente. Se toman los campos opcionales
  // (teléfono, empresa, estado, notas, propietario) cuando están presentes; el
  // estado por defecto lo aporta el esquema Prisma si se omite.
  const data: Record<string, unknown> = {
    name: body.name.trim(),
    email: body.email.trim(),
    phone: body.phone,
    company: body.company,
    notes: body.notes,
    lastActivityAt: new Date(),
  }
  if (body.status !== undefined) data.status = body.status
  if (body.ownerId !== undefined) data.ownerId = body.ownerId

  const client = await context.entities.Client.create({ data })

  // Req 11.1: responder 201 con la representación serializable del Cliente.
  res.status(201).json(serializeClient(client))
}
