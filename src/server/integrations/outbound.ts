// Capa de automatización de salida genérica
//
// Generaliza la notificación de salida para que funcione con CUALQUIER sistema
// externo (Make, n8n, un endpoint HTTP propio, Zapier, etc.), no solo con
// Zapier. Cuando un Cliente se crea o actualiza, se difunde (fan-out) la
// representación del Cliente a una LISTA configurable de destinos.
//
// Los destinos se resuelven desde la configuración:
//   - `OUTBOUND_WEBHOOK_URLS`: lista genérica separada por comas/espacios.
//   - `ZAPIER_WEBHOOK_URL`:    destino único heredado (compatibilidad hacia atrás).
// Ambas fuentes se combinan y se deduplican.
//
// Garantías de resiliencia (idénticas a la integración original de Zapier):
//   - Si no hay ningún destino configurado, se omite el envío en silencio.
//   - El envío a cada destino es independiente: un fallo en uno se captura y
//     registra, y NO impide los intentos a los demás.
//   - La función NUNCA lanza, de modo que la operación de Cliente jamás se
//     bloquea ni se revierte por un fallo de notificación.
//
// Requisitos cubiertos:
// - 10.1: Al crear/actualizar un Cliente se hace POST con su representación a
//         cada webhook de salida configurado.
// - 10.3: Si no hay destinos configurados, se omite el envío.
// - 10.4: Un fallo de un destino se captura y registra, sin revertir ni propagar.

import type { Client } from 'wasp/entities'

import { config } from '../config.js'
import { serializeClient } from '../chat/context.js'

export type OutboundEvent = 'created' | 'updated'

/**
 * Resuelve la lista de destinos de salida a notificar.
 *
 * Combina la lista genérica `OUTBOUND_WEBHOOK_URLS` con el destino heredado
 * `ZAPIER_WEBHOOK_URL` (si está configurado) y elimina duplicados preservando
 * el orden de primera aparición.
 */
export function resolverDestinos(): string[] {
  const destinos = [...config.outboundWebhookUrls()]

  // Compatibilidad hacia atrás: incluir el webhook único de Zapier si existe.
  const zapier = config.zapierWebhookUrl()?.trim()
  if (zapier && zapier.length > 0) destinos.push(zapier)

  // Deduplicar conservando el orden de primera aparición.
  return [...new Set(destinos)]
}

/**
 * Notifica a todos los sistemas externos configurados que un Cliente fue creado
 * o actualizado.
 *
 * Comportamiento:
 *   1. Resuelve la lista de destinos (genéricos + Zapier heredado), deduplicada.
 *      Si está vacía, se omite el envío sin error (Requisito 10.3).
 *   2. Para cada destino hace POST con `{ event, client }`, usando la
 *      representación serializable del Cliente (Requisito 10.1).
 *   3. Los envíos se realizan en paralelo y de forma aislada: el fallo de un
 *      destino se captura y registra sin afectar a los demás ni propagar la
 *      excepción (Requisito 10.4). La función nunca lanza.
 *
 * @param client Cliente recién persistido.
 * @param event  Tipo de evento que originó la notificación.
 */
export async function notificarClienteEvento(
  client: Client,
  event: OutboundEvent
): Promise<void> {
  const destinos = resolverDestinos()
  if (destinos.length === 0) return // Requisito 10.3: omitir si no hay destinos

  // Cuerpo común para todos los destinos: la representación serializable del
  // Cliente más el tipo de evento (Requisito 10.1).
  const body = JSON.stringify({ event, client: serializeClient(client) })

  // Cada destino se envía de forma aislada: `enviarA` captura sus propios
  // fallos, por lo que `Promise.all` nunca rechaza (Requisito 10.4).
  await Promise.all(destinos.map((url) => enviarA(url, body)))
}

/**
 * Envía el cuerpo a un único destino, capturando cualquier fallo.
 *
 * Aísla el envío a un destino para que una excepción de red o del webhook no
 * impida los intentos a los demás ni se propague (Requisito 10.4).
 */
async function enviarA(url: string, body: string): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  } catch (err) {
    // Requisito 10.4: registrar y continuar; no se revierte ni se propaga.
    console.error(`Fallo al notificar al destino de salida (${url}):`, err)
  }
}
