// Operaciones de Cliente — Acciones (Tarea 4.2)
//
// Implementa las acciones de escritura del CRM sobre la entidad `Client`:
//   - createClient: valida y persiste un Cliente asociado al Agente propietario.
//   - updateClient: verifica propiedad, valida y actualiza los campos y la
//                   marca de última actividad.
//   - deleteClient: elimina el Cliente y, de forma atómica, sus Registro_Actividad
//                   asociados.
//
// Todas las acciones exigen una sesión de Agente autenticada (Requisito 1.2) y
// asocian/validan el identificador de propietario (Requisitos 1.3, 1.4).
//
// Requisitos cubiertos: 2.1, 2.4, 2.5, 1.3.

import type {
  CreateClient,
  UpdateClient,
  DeleteClient,
  AddActivity,
} from 'wasp/server/operations'
import type { Client, Activity } from 'wasp/entities'

import { requireUser, requireOwnership } from '../auth/ownership.js'
import {
  validateClientInput,
  validateActivityContent,
  type ClientInput,
} from './validation.js'

// Notificación de salida genérica. Se invoca tras persistir el Cliente en
// `createClient` (evento 'created') y en `updateClient` (evento 'updated').
// `notificarClienteEvento` difunde la notificación a TODOS los destinos
// externos configurados (Make, n8n, HTTP propio, Zapier, etc.), captura
// internamente cualquier fallo por destino y nunca propaga, de modo que la
// automatización jamás bloquea ni revierte la operación de Cliente
// (Requisitos 10.1, 10.3, 10.4).
import { notificarClienteEvento } from '../integrations/outbound.js'

/**
 * Crea un Cliente del Agente autenticado (Requisitos 2.1, 1.3).
 *
 * Valida nombre y correo electrónico, asocia el `ownerId` del Agente y fija
 * `lastActivityAt` al momento de la creación para el orden del listado.
 */
export const createClient: CreateClient<ClientInput, Client> = async (
  input,
  context
) => {
  const ownerId = requireUser(context)
  validateClientInput(input)

  const client = await context.entities.Client.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      status: input.status,
      notes: input.notes,
      ownerId,
      lastActivityAt: new Date(),
    },
  })

  // Notifica el alta del Cliente a los destinos externos configurados; un
  // fallo nunca afecta a esta operación (Requisitos 10.1, 10.3, 10.4).
  await notificarClienteEvento(client, 'created')
  return client
}

type UpdateClientInput = ClientInput & { id: number }

/**
 * Actualiza un Cliente del que el Agente es propietario (Requisito 2.4).
 *
 * Verifica la propiedad antes de modificar (Requisito 1.4), valida la entrada y
 * actualiza `lastActivityAt` para reflejar la actividad reciente.
 */
export const updateClient: UpdateClient<UpdateClientInput, Client> = async (
  { id, ...input },
  context
) => {
  const ownerId = requireUser(context)
  validateClientInput(input)

  const existing = await context.entities.Client.findUnique({ where: { id } })
  await requireOwnership(existing, ownerId)

  const client = await context.entities.Client.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      status: input.status,
      notes: input.notes,
      lastActivityAt: new Date(),
    },
  })

  // Notifica la actualización del Cliente a los destinos externos configurados;
  // un fallo nunca afecta a esta operación (Requisitos 10.1, 10.3, 10.4).
  await notificarClienteEvento(client, 'updated')
  return client
}

type DeleteClientInput = { id: number }

/**
 * Elimina un Cliente del que el Agente es propietario junto con sus
 * Registro_Actividad asociados (Requisito 2.5).
 *
 * Se eliminan primero las actividades asociadas y luego el Cliente. La
 * integridad referencial está además garantizada de forma atómica por la
 * regla `onDelete: Cascade` declarada en la entidad `Activity` (ver
 * `main.wasp`): al borrarse el Cliente no puede quedar ninguna actividad
 * huérfana asociada a él.
 */
export const deleteClient: DeleteClient<DeleteClientInput, Client> = async (
  { id },
  context
) => {
  const ownerId = requireUser(context)

  const existing = await context.entities.Client.findUnique({ where: { id } })
  await requireOwnership(existing, ownerId)

  // Eliminación explícita de las actividades asociadas (Requisito 2.5).
  await context.entities.Activity.deleteMany({ where: { clientId: id } })

  // Eliminación del Cliente; el borrado en cascada respalda la consistencia.
  const client = await context.entities.Client.delete({ where: { id } })

  return client
}

type AddActivityInput = { clientId: number; content: string }

/**
 * Registra una entrada de actividad o nota sobre un Cliente del que el Agente
 * es propietario (Requisitos 4.1, 4.3).
 *
 * Flujo:
 *   1. Exige sesión de Agente autenticada (Requisito 1.2).
 *   2. Valida que el contenido no esté vacío ni compuesto solo por espacios
 *      (Requisito 4.3); de lo contrario lanza `HttpError 400` en español.
 *   3. Verifica la propiedad del Cliente antes de escribir (Requisito 1.4); si
 *      el Cliente no existe o pertenece a otro Agente, lanza `HttpError 403`.
 *   4. Crea el `Activity` asociado con su marca de tiempo (Requisito 4.1).
 *   5. Actualiza `lastActivityAt` del Cliente para reflejar la actividad
 *      reciente en el orden del listado (Requisito 2.6).
 *
 * @returns El `Activity` recién creado.
 */
export const addActivity: AddActivity<AddActivityInput, Activity> = async (
  { clientId, content },
  context
) => {
  const ownerId = requireUser(context)
  validateActivityContent(content)

  const client = await context.entities.Client.findUnique({
    where: { id: clientId },
  })
  await requireOwnership(client, ownerId)

  const now = new Date()
  const activity = await context.entities.Activity.create({
    data: {
      content,
      clientId,
      createdAt: now,
    },
  })

  // Actualiza la marca de última actividad del Cliente (Requisito 2.6).
  await context.entities.Client.update({
    where: { id: clientId },
    data: { lastActivityAt: now },
  })

  return activity
}
