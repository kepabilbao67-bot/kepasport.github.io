// Capa_Zapier — salida (Tarea 12.1)
//
// Notifica cuando un Cliente se crea o actualiza. Históricamente esta capa
// hablaba únicamente con Zapier; ahora delega en la capa de automatización de
// salida GENÉRICA (`./outbound.ts`), que difunde la notificación a CUALQUIER
// sistema externo configurado (Make, n8n, HTTP propio, etc.) además del webhook
// heredado de Zapier. Este módulo se conserva como fachada compatible hacia
// atrás: el comportamiento es idéntico cuando solo `ZAPIER_WEBHOOK_URL` está
// configurado.
//
// La integración está deliberadamente desacoplada de las acciones de Wasp: las
// acciones de Cliente la invocan tras persistir, pero un fallo aquí nunca debe
// revertir ni bloquear la operación de Cliente.
//
// Requisitos cubiertos:
// - 10.1: Al crear/actualizar un Cliente se hace POST con su representación al/los
//         webhook(s) de salida configurado(s).
// - 10.3: Si no hay ningún destino configurado, se omite el envío.
// - 10.4: Un fallo del webhook se captura y registra, sin revertir ni propagar.

import type { Client } from 'wasp/entities'

import { notificarClienteEvento, type OutboundEvent } from './outbound.js'

/**
 * Notifica que un Cliente fue creado o actualizado.
 *
 * Fachada de compatibilidad hacia atrás que delega en
 * `notificarClienteEvento`, el cual resuelve la lista de destinos configurados
 * (genéricos + Zapier heredado), difunde el envío y garantiza la resiliencia:
 * omite el envío si no hay destinos (Requisito 10.3), aísla los fallos por
 * destino (Requisito 10.4) y nunca propaga la excepción.
 *
 * @param client Cliente recién persistido.
 * @param event  Tipo de evento que originó la notificación.
 */
export async function notificarCliente(
  client: Client,
  event: OutboundEvent
): Promise<void> {
  await notificarClienteEvento(client, event)
}
