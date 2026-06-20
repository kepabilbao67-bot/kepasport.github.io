# Documento de Diseño

## Visión General

Este documento describe el diseño técnico de un **CRM de clientes** construido sobre **Wasp** (framework full-stack que genera frontend React y backend Node.js, con persistencia mediante **Prisma**), escrito en **TypeScript**. El producto permite a agentes autenticados gestionar clientes y su actividad, conversar con un **asistente de IA basado en el modelo Claude de Anthropic** (con respuestas transmitidas token a token vía SSE), notifica los cambios de Cliente a una **lista configurable de destinos de salida** (Zapier, Make, n8n o un endpoint HTTP propio) mediante una **capa de automatización de salida genérica**, y se integra con **Zapier** mediante un endpoint de entrada autenticado. Además, la base de datos se inicializa con una **semilla idempotente** que crea un cliente de demostración.

El diseño persigue tres objetivos transversales:

1. **Aislamiento por propietario (multi-agente):** cada registro (Cliente, Actividad, Conversación, Mensaje) pertenece a un Agente y solo es visible para él.
2. **Separación de responsabilidades:** la lógica de integración con Claude y con los sistemas externos de automatización se aísla en capas dedicadas (`Proveedor_Claude`, `Capa_Salida` genérica) desacopladas de las operaciones de Wasp y de la UI.
3. **Configuración externalizada:** secretos y parámetros (clave de API, modelo, lista de URLs de webhook de salida, token de integración) viven en `.env`, excluido del control de versiones.

Toda la interfaz y los mensajes de error se presentan **en español**.

### Mapa de Requisitos a Componentes

| Requisito | Componente(s) responsable(s) |
|-----------|------------------------------|
| 1. Acceso autenticado / aislamiento | Wasp auth, middleware de operaciones, capa de acceso a datos |
| 2. CRUD de clientes | `actions` de Cliente, `queries` de Cliente, entidad Prisma `Client` |
| 3. Búsqueda | query `searchClients` |
| 4. Actividad y notas | `actions`/`queries` de Actividad, entidad Prisma `Activity` |
| 5. Asistente conversacional con streaming | endpoint SSE `chatStream`, `Proveedor_Claude`, `Interfaz_Chat` |
| 6. Redactar / resumir | endpoint SSE + `Constructor_Contexto`, comprobación de propiedad |
| 7. Persistencia de conversaciones | entidades `Conversation`/`Message`, queries asociadas |
| 8. Configuración del modelo | `Gestor_Configuracion`, `Proveedor_Claude` |
| 9. Manejo de errores del modelo | `Proveedor_Claude`, endpoint SSE, `Interfaz_Chat` |
| 10. Automatización de salida multi-destino | `Capa_Salida.notificarClienteEvento`/`resolverDestinos`, hooks en actions de Cliente |
| 11. Endpoint de entrada de Zapier | endpoint `api` `zapierInbound` |
| 12. UI en español | componentes React, catálogo de textos |
| 13. Semilla inicial de la base de datos | `seeds.seedKepaBilbao`, `app.db.seeds` en `main.wasp` |

## Arquitectura

### Diagrama de alto nivel

```
+-------------------------------------------------------------+
|                     Navegador (React)                       |
|  GestorClientes  DetalleCliente  Busqueda  InterfazChat     |
+-------------------------------------------------------------+
        |  operations (RPC)        |  fetch + EventSource (SSE)
        v                          v
+-------------------------------------------------------------+
|                  Backend Wasp (Node.js)                     |
|                                                             |
|  queries/actions          api endpoints                     |
|  - getClients             - chatStream (SSE)                |
|  - createClient           - zapierInbound (REST)            |
|  - updateClient                                             |
|  - deleteClient        +------------------------------+     |
|  - searchClients       |  Capas de integración        |     |
|  - addActivity         |  - Proveedor_Claude          |     |
|  - getConversations    |  - Capa_Salida (multi-dest.) |     |
|  - getMessages         |  - Constructor_Contexto      |     |
|                        |  - Gestor_Configuracion      |     |
|                        +------------------------------+     |
+-------------------------------------------------------------+
        |  Prisma Client                  |  HTTPS
        v                                 v
+--------------------------+   +-----------------------------+
|  Base de datos (Prisma)  |   |  API de Anthropic (Claude)  |
|  User Client Activity    |   |  Destinos de salida:        |
|  Conversation Message    |   |  Zapier / Make / n8n / HTTP |
+--------------------------+   +-----------------------------+
```

### Flujo de una solicitud de chat con streaming

1. El Agente escribe un mensaje en `InterfazChat` y se envía vía `fetch`/`EventSource` al endpoint `api` `chatStream` (autenticado por la sesión de Wasp).
2. El endpoint valida la sesión y el contenido, crea la `Conversation` si es el primer mensaje, persiste el `Message` del usuario.
3. `Constructor_Contexto` arma el historial (y, si aplica, datos de Cliente/Actividad para redactar o resumir).
4. `Proveedor_Claude` invoca la API de Anthropic en modo stream; cada token recibido se reenvía como evento SSE a la UI.
5. Al completarse, el backend persiste el `Message` del asistente. Ante error, finaliza el stream y emite un evento de error.

### Flujo de creación de cliente con notificación de salida

1. `createClient` valida y persiste el Cliente.
2. Tras la persistencia, invoca `Capa_Salida.notificarClienteEvento(cliente, 'created')` (y `'updated'` en `updateClient`).
3. `resolverDestinos()` construye la lista deduplicada de destinos combinando `OUTBOUND_WEBHOOK_URLS` y el `ZAPIER_WEBHOOK_URL` heredado. Si la lista está vacía, se omite el envío. Si tiene destinos, se hace POST a todos en paralelo; el fallo de cualquiera se registra pero no revierte la operación ni bloquea a los demás.

### Flujo de inicialización con semilla

1. Al ejecutar la semilla de Wasp (`app.db.seeds`), se invoca `seedKepaBilbao(prisma)`.
2. Se garantiza la existencia de un Usuario propietario (se reutiliza el primero o se crea uno mínimo).
3. Si ya existe un Cliente con el correo de demostración, se omite la creación (idempotencia); en caso contrario, se crea el Cliente_Demo "Kepa Bilbao".

## Componentes e Interfaces

### Configuración de Wasp (`main.wasp`)

Declara entidades, operaciones y endpoints `api`. Esquema conceptual:

```wasp
app clientCrm {
  title: "CRM de Clientes",
  auth: {
    userEntity: User,
    methods: { usernameAndPassword: {} },
    onAuthFailedRedirectTo: "/login"
  },
  db: {
    // Semilla idempotente que crea el Cliente_Demo "Kepa Bilbao" (Requisito 13)
    seeds: [ import { seedKepaBilbao } from "@server/seeds.js" ]
  }
}

// Entidades persistidas con Prisma (ver Modelos de Datos)
entity User {=psl ... psl=}
entity Client {=psl ... psl=}
entity Activity {=psl ... psl=}
entity Conversation {=psl ... psl=}
entity Message {=psl ... psl=}

// Consultas
query getClients { fn: import { getClients } from "@server/clients/queries.js", entities: [Client] }
query searchClients { fn: import { searchClients } from "@server/clients/queries.js", entities: [Client] }
query getClient { fn: import { getClient } from "@server/clients/queries.js", entities: [Client, Activity] }
query getConversations { fn: import { getConversations } from "@server/chat/queries.js", entities: [Conversation] }
query getMessages { fn: import { getMessages } from "@server/chat/queries.js", entities: [Conversation, Message] }

// Acciones
action createClient { fn: import { createClient } from "@server/clients/actions.js", entities: [Client] }
action updateClient { fn: import { updateClient } from "@server/clients/actions.js", entities: [Client] }
action deleteClient { fn: import { deleteClient } from "@server/clients/actions.js", entities: [Client, Activity] }
action addActivity  { fn: import { addActivity  } from "@server/clients/actions.js", entities: [Client, Activity] }

// Endpoint SSE del asistente
api chatStream {
  fn: import { chatStream } from "@server/chat/stream.js",
  entities: [Conversation, Message, Client, Activity],
  httpRoute: (POST, "/api/chat/stream"),
  auth: true
}

// Endpoint de entrada de Zapier (autenticado por token, sin sesión de Wasp)
api zapierInbound {
  fn: import { zapierInbound } from "@server/integrations/zapierInbound.js",
  entities: [Client],
  httpRoute: (POST, "/api/integrations/zapier/clients"),
  auth: false
}
```

### Capa de acceso a datos y aislamiento por propietario

Todas las queries y actions reciben `context.user` de Wasp. Una utilidad central garantiza el aislamiento:

```typescript
// server/auth/ownership.ts
import { HttpError } from 'wasp/server'

export function requireUser(context: { user?: { id: number } }): number {
  if (!context.user) throw new HttpError(401, 'No autorizado')
  return context.user.id
}

// Garantiza que el registro pertenece al agente; si no, 403/404.
export async function requireOwnership<T extends { ownerId: number }>(
  record: T | null,
  ownerId: number
): Promise<T> {
  if (!record || record.ownerId !== ownerId) {
    throw new HttpError(403, 'Recurso no disponible')
  }
  return record
}
```

Toda consulta de listado filtra siempre por `where: { ownerId }`.

### Operaciones de Cliente (`server/clients/actions.ts`, `queries.ts`)

```typescript
type ClientInput = {
  name: string
  email: string
  phone?: string
  company?: string
  status?: string
  notes?: string
}

// Validación reutilizable (Requisitos 2.2, 2.3)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateClientInput(input: ClientInput): void {
  if (!input.name?.trim()) throw new HttpError(400, 'El nombre es obligatorio')
  if (!input.email?.trim()) throw new HttpError(400, 'El correo electrónico es obligatorio')
  if (!EMAIL_RE.test(input.email)) throw new HttpError(400, 'El formato del correo electrónico no es válido')
}

export const createClient = async (input: ClientInput, context) => {
  const ownerId = requireUser(context)
  validateClientInput(input)
  const client = await context.entities.Client.create({
    data: { ...input, ownerId, lastActivityAt: new Date() }
  })
  await notificarClienteEvento(client, 'created') // Capa_Salida (no bloquea ante fallo)
  return client
}

export const searchClients = async ({ term }: { term: string }, context) => {
  const ownerId = requireUser(context)
  const t = term.trim().toLowerCase()
  // Filtro case-insensitive sobre name/email/company (Requisito 3.1)
  return context.entities.Client.findMany({
    where: {
      ownerId,
      OR: [
        { name:    { contains: t, mode: 'insensitive' } },
        { email:   { contains: t, mode: 'insensitive' } },
        { company: { contains: t, mode: 'insensitive' } }
      ]
    },
    orderBy: { lastActivityAt: 'desc' }
  })
}
```

`updateClient` aplica `requireOwnership`, valida, actualiza `lastActivityAt` y notifica a los destinos de salida mediante `notificarClienteEvento(client, 'updated')`. `deleteClient` elimina el Cliente y, en una transacción, sus `Activity` asociadas (Requisito 2.5). `addActivity` valida contenido no vacío y actualiza `lastActivityAt` del Cliente (Requisitos 4.1, 4.3).

### Gestor de Configuración (`server/config.ts`)

```typescript
export const config = {
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY,
  claudeModel:     () => process.env.CLAUDE_MODEL ?? 'claude-3-5-sonnet', // Requisitos 8.1, 8.2
  zapierWebhookUrl:() => process.env.ZAPIER_WEBHOOK_URL,                  // Requisito 10.2 (heredado)
  zapierToken:     () => process.env.ZAPIER_INBOUND_TOKEN,               // Requisito 11.4

  // Lista de destinos de salida genéricos (Make, n8n, HTTP propio, etc.).
  // Acepta URLs separadas por comas y/o espacios; descarta entradas vacías.
  // No deduplica: la combinación con `zapierWebhookUrl()` y la deduplicación
  // se realizan en la Capa_Salida (`resolverDestinos`). (Requisito 10.2)
  outboundWebhookUrls: (): string[] => {
    const raw = process.env.OUTBOUND_WEBHOOK_URLS
    if (!raw) return []
    return raw.split(/[\s,]+/).map(u => u.trim()).filter(u => u.length > 0)
  }
}
```

### Proveedor_Claude (`server/chat/claudeProvider.ts`)

Capa de integración con el SDK de Anthropic. Encapsula la selección de modelo, la lectura de la clave y el manejo de errores. Expone un async iterator de tokens.

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { HttpError } from 'wasp/server'
import { config } from '../config.js'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function* streamCompletion(
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const apiKey = config.anthropicApiKey()
  if (!apiKey) throw new HttpError(500, 'Falta la configuración de la clave de API') // Req 8.5
  const client = new Anthropic({ apiKey })
  const stream = await client.messages.stream({
    model: config.claudeModel(),
    max_tokens: 1024,
    messages
  })
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}
```

### Constructor_Contexto (`server/chat/context.ts`)

Arma el arreglo de mensajes para Claude. Para acciones de redactar o resumir, inserta los datos del Cliente (y sus actividades en el caso de resumen) tras verificar la propiedad.

```typescript
export async function buildContext(opts: {
  history: ChatMessage[]
  intent: 'chat' | 'draft' | 'summary'
  client?: Client
  activities?: Activity[]
}): ChatMessage[] {
  const system: string[] = []
  if (opts.client) {
    system.push(`Datos del cliente: ${JSON.stringify(serializeClient(opts.client))}`)
  }
  if (opts.intent === 'summary' && opts.activities) {
    system.push(`Actividad: ${opts.activities.map(a => `${a.createdAt}: ${a.content}`).join('\n')}`)
  }
  const preamble = system.length ? [{ role: 'user' as const, content: system.join('\n\n') }] : []
  return [...preamble, ...opts.history]
}
```

### Endpoint SSE `chatStream` (`server/chat/stream.ts`)

```typescript
export const chatStream = async (req, res, context) => {
  const ownerId = requireUser(context)              // Req 1.2
  const { conversationId, content, intent, clientId } = req.body
  if (!content?.trim()) { res.status(400).json({ error: 'El mensaje no puede estar vacío' }); return } // Req 5.5

  // Resolver/crear conversación propia (Req 7.1, 7.5)
  const conversation = conversationId
    ? await requireOwnership(await getConv(conversationId), ownerId)
    : await context.entities.Conversation.create({ data: { ownerId } })

  // Verificación de propiedad del cliente para draft/summary (Req 6.3)
  let client, activities
  if (clientId) {
    client = await requireOwnership(await getClient(clientId), ownerId)
    if (intent === 'summary') activities = await getActivities(clientId)
  }

  // Persistir mensaje del usuario antes de invocar al modelo (Req 9.1)
  await context.entities.Message.create({ data: { conversationId: conversation.id, role: 'user', content } })

  // Cabeceras SSE
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })

  const history = await loadHistory(conversation.id)
  const messages = buildContext({ history, intent, client, activities })

  let acc = ''
  try {
    for await (const token of streamCompletion(messages)) {
      acc += token
      res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`) // Req 5.2
    }
    await context.entities.Message.create({
      data: { conversationId: conversation.id, role: 'assistant', content: acc }
    }) // Req 5.4, 7.2
    res.write(`event: done\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`)
  } catch (err) {
    // Req 9.1, 9.2: finalizar stream e informar; el mensaje del usuario ya está persistido
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'El asistente no pudo responder' })}\n\n`)
  } finally {
    res.end()
  }
}
```

### Capa_Salida — automatización de salida genérica (`server/integrations/outbound.ts`)

Capa de automatización de salida **multi-destino**. Generaliza la notificación para funcionar con cualquier sistema externo (Zapier, Make, n8n, un endpoint HTTP propio, etc.). `resolverDestinos()` construye la lista deduplicada de URLs combinando `config.outboundWebhookUrls()` (de `OUTBOUND_WEBHOOK_URLS`) con el `config.zapierWebhookUrl()` heredado. `notificarClienteEvento()` difunde (fan-out) el mismo cuerpo a todos los destinos en paralelo, aislando los fallos por destino y sin propagar nunca la excepción.

```typescript
export type OutboundEvent = 'created' | 'updated'

// Combina la lista genérica + el Zapier heredado y deduplica preservando orden.
export function resolverDestinos(): string[] {
  const destinos = [...config.outboundWebhookUrls()]
  const zapier = config.zapierWebhookUrl()?.trim()
  if (zapier && zapier.length > 0) destinos.push(zapier) // compatibilidad hacia atrás
  return [...new Set(destinos)]
}

export async function notificarClienteEvento(client: Client, event: OutboundEvent): Promise<void> {
  const destinos = resolverDestinos()
  if (destinos.length === 0) return // Req 10.3: omitir si no hay destinos
  const body = JSON.stringify({ event, client: serializeClient(client) }) // Req 10.1
  // Cada destino se envía aislado; un fallo se captura y registra (Req 10.4).
  await Promise.all(destinos.map(url => enviarA(url, body)))
}

async function enviarA(url: string, body: string): Promise<void> {
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  } catch (err) {
    console.error(`Fallo al notificar al destino de salida (${url}):`, err) // Req 10.4
  }
}
```

El llamador nunca propaga la excepción: la operación de Cliente se completa con independencia del resultado de los webhooks.

### Capa_Zapier — fachada de compatibilidad (`server/integrations/zapierOutbound.ts`)

Se conserva `notificarCliente` como **fachada compatible hacia atrás** que delega en `notificarClienteEvento`. Su comportamiento es idéntico cuando solo `ZAPIER_WEBHOOK_URL` está configurado, de modo que las configuraciones anteriores siguen funcionando sin cambios.

```typescript
export async function notificarCliente(client: Client, event: OutboundEvent): Promise<void> {
  await notificarClienteEvento(client, event) // delega en la Capa_Salida genérica
}
```

### Endpoint de entrada de Zapier (`server/integrations/zapierInbound.ts`)

```typescript
export const zapierInbound = async (req, res, context) => {
  const token = req.get('X-Zapier-Token') ?? req.body?.token
  if (token !== config.zapierToken()) {            // Req 11.2
    res.status(401).json({ error: 'Token de integración no válido' }); return
  }
  const { name, email, phone, company, status, notes, ownerId } = req.body
  if (!name?.trim() || !email?.trim()) {           // Req 11.3
    res.status(400).json({ error: 'El nombre y el correo electrónico son obligatorios' }); return
  }
  const client = await context.entities.Client.create({
    data: { name, email, phone, company, status, notes, ownerId, lastActivityAt: new Date() }
  }) // Req 11.1
  res.status(201).json(serializeClient(client))
}
```

### Semilla de la base de datos (`server/seeds.ts`)

Inicializa la base de datos con un Cliente_Demo de arranque. Se cablea en `main.wasp` bajo `app.db.seeds` con la firma de semilla de Wasp 0.13 `(prismaClient) => Promise<void>`. La semilla es **idempotente**: identifica el Cliente_Demo por un correo de marcador y omite la creación si ya existe, de modo que ejecutarla varias veces no genera duplicados (Requisitos 13.1, 13.2).

```typescript
const KEPA_EMAIL = 'kepa.bilbao@example.com'

export const seedKepaBilbao = async (prisma: PrismaClient): Promise<void> => {
  // 1. Garantizar un Usuario propietario: reutilizar el primero o crear uno mínimo.
  let owner = await prisma.user.findFirst()
  if (!owner) owner = await prisma.user.create({ data: {} })

  // 2. Idempotencia: no duplicar si el Cliente_Demo ya existe (Req 13.2).
  const existente = await prisma.client.findFirst({ where: { email: KEPA_EMAIL } })
  if (existente) return

  // 3. Crear el Cliente_Demo "Kepa Bilbao" asociado al propietario (Req 13.1).
  await prisma.client.create({
    data: {
      name: 'Kepa Bilbao', email: KEPA_EMAIL, phone: '+34 600 000 000',
      company: 'Bilbao Consulting', status: 'activo',
      notes: 'Cliente inicial creado por la semilla de la base de datos.',
      ownerId: owner.id, lastActivityAt: new Date()
    }
  })
}
```

Wasp gestiona las identidades de autenticación (usuario/contraseña) en sus propias entidades Auth/AuthIdentity; por ello la semilla solo crea una fila mínima de `User` que actúe como propietario del Cliente cuando no existe ninguno.

### Componentes React (frontend, en español)

- **`PaginaClientes`**: usa `getClients`/`searchClients`; muestra listado ordenado por actividad reciente y una barra de búsqueda; mensaje "No se encontraron resultados" cuando procede (Req 3.2).
- **`FormularioCliente`**: crea/edita; muestra mensajes de validación en español (Req 12.2).
- **`DetalleCliente`**: muestra campos del Cliente y `Activity` en orden cronológico; permite añadir notas y disparar acciones del asistente (redactar/resumir).
- **`InterfazChat`**: lista de conversaciones del agente, hilo de mensajes y caja de envío. Abre la conexión SSE y aplica un reducer de acumulación de tokens.

```typescript
// Reducer de acumulación incremental (Req 5.3)
function streamReducer(state: string, chunk: string): string {
  return state + chunk
}
```

Un catálogo central de cadenas (`es.ts`) concentra todas las etiquetas y mensajes en español (Req 12.1, 12.2).

## Modelos de Datos

### Esquema Prisma (conceptual)

```prisma
model User {
  id            Int            @id @default(autoincrement())
  clients       Client[]
  conversations Conversation[]
}

model Client {
  id             Int        @id @default(autoincrement())
  name           String
  email          String
  phone          String?
  company        String?
  status         String     @default("prospecto")
  notes          String?
  ownerId        Int
  owner          User       @relation(fields: [ownerId], references: [id])
  activities     Activity[]
  lastActivityAt DateTime   @default(now())
  createdAt      DateTime   @default(now())
  @@index([ownerId])
}

model Activity {
  id        Int      @id @default(autoincrement())
  content   String
  clientId  Int
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@index([clientId])
}

model Conversation {
  id        Int       @id @default(autoincrement())
  ownerId   Int
  owner     User      @relation(fields: [ownerId], references: [id])
  messages  Message[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  @@index([ownerId])
}

model Message {
  id             Int          @id @default(autoincrement())
  role           String       // "user" | "assistant"
  content        String
  conversationId Int
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
  @@index([conversationId])
}
```

La eliminación en cascada (`onDelete: Cascade`) garantiza la integridad referencial al eliminar Clientes (Req 2.5) y Conversaciones.

## Gestión de Configuración y Entorno

| Variable | Propósito | Valor por defecto | Requisitos |
|----------|-----------|-------------------|------------|
| `ANTHROPIC_API_KEY` | Clave de API de Anthropic | (ninguno; error si falta) | 8.3, 8.5 |
| `CLAUDE_MODEL` | Identificador del modelo | `claude-3-5-sonnet` | 8.1, 8.2 |
| `OUTBOUND_WEBHOOK_URLS` | Lista de destinos de salida (Zapier, Make, n8n, HTTP propio), separados por comas o espacios | (ninguno; lista vacía) | 10.1, 10.2 |
| `ZAPIER_WEBHOOK_URL` | URL de webhook de salida heredada; se conserva por **compatibilidad hacia atrás** y se combina con `OUTBOUND_WEBHOOK_URLS` | (ninguno; se omite) | 10.2, 10.3 |
| `ZAPIER_INBOUND_TOKEN` | Token del endpoint de entrada | (ninguno; rechaza todo) | 11.4 |

- Las variables se leen en tiempo de ejecución desde `.env` mediante `Gestor_Configuracion`.
- `.env` se añade a `.gitignore` y se excluye del control de versiones (Req 8.4). Se provee `.env.example` con claves vacías como documentación.

## Manejo de Errores

| Escenario | Detección | Respuesta del backend | Respuesta de la UI | Requisitos |
|-----------|-----------|-----------------------|--------------------|------------|
| Solicitud no autenticada | `requireUser` sin `context.user` | `HttpError 401` | Redirección a login | 1.2 |
| Acceso a registro ajeno | `requireOwnership` | `HttpError 403` | Mensaje "Recurso no disponible" | 1.4, 6.3, 7.5 |
| Nombre/email vacío | `validateClientInput` | `HttpError 400` | Mensaje de validación en español | 2.2, 4.3, 5.5 |
| Email con formato inválido | regex de email | `HttpError 400` | Mensaje de validación en español | 2.3 |
| Falta clave de API | `Proveedor_Claude` | `HttpError 500` (no invoca modelo) | Mensaje de error en español | 8.5 |
| Error de la API de Claude | `try/catch` en stream | evento SSE `error`; conserva mensaje del usuario | Mensaje de error en español | 9.1, 9.3 |
| Interrupción del stream | `catch`/`finally` | finaliza stream, evento `error` | Indicación de interrupción | 9.2 |
| Fallo de un destino de salida | `try/catch` por destino en `notificarClienteEvento` | log; los demás destinos se intentan; operación de Cliente continúa | (sin impacto en la operación) | 10.4 |
| Token de Zapier inválido | comparación de token | `401` | n/a (integración) | 11.2 |
| Falta nombre/email en entrada Zapier | validación | `400` | n/a (integración) | 11.3 |

Todos los mensajes de cara al usuario se devuelven y muestran en español (Req 12.2).

## Estrategia de Pruebas

Se adopta un **enfoque dual**: pruebas basadas en ejemplos (casos concretos, integración, idioma) y pruebas basadas en propiedades (PBT, con al menos **100 iteraciones** por propiedad). Se recomienda **Vitest** como runner y **fast-check** para PBT.

### Pruebas por ejemplos / integración / smoke

- **Auth de rutas (1.1):** una ruta protegida sin sesión redirige a login.
- **Sin resultados (3.2):** búsqueda sin coincidencias muestra el mensaje en español.
- **Modelo por defecto (8.2):** sin `CLAUDE_MODEL`, el proveedor usa `claude-3-5-sonnet`.
- **Smoke de configuración (8.3, 8.4, 10.2, 11.4):** la clave/URLs/token se leen de `.env`; `.gitignore` excluye `.env`.
- **Interrupción de stream (9.2) y error en UI (9.3):** ante un proveedor que falla, la UI muestra texto en español.
- **Semilla idempotente (13.1):** ejecutar la semilla sobre una base de datos vacía crea un único Cliente_Demo "Kepa Bilbao" con propietario (el caso multi-ejecución se cubre como propiedad).
- **Idioma de la UI (12.1, 12.2):** los componentes renderizan etiquetas y mensajes en español.

Las pruebas que tocan Anthropic y los destinos de salida usan **mocks** de `Proveedor_Claude` y de `fetch` para evitar llamadas reales.

### Pruebas basadas en propiedades

Cada prueba de propiedad referencia su propiedad de diseño con la etiqueta:
**Feature: claude-chatbot-assistant, Property {número}: {texto}**

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe cumplirse en todas las ejecuciones válidas del sistema; es una afirmación formal sobre lo que el sistema debe hacer, y sirve de puente entre las especificaciones legibles por humanos y las garantías de corrección verificables por máquina.*

### Property 1: Rechazo de solicitudes no autenticadas

Para toda operación protegida del backend invocada sin un usuario en el contexto, la operación debe rechazarse con un error de autorización y no debe modificar ni devolver datos.

**Validates: Requirements 1.2**

### Property 2: Asociación del propietario al crear registros

Para todo registro (Cliente, Registro_Actividad, Conversacion, Mensaje) creado por un Agente, el identificador de propietario del registro persistido debe ser igual al identificador de ese Agente.

**Validates: Requirements 1.3**

### Property 3: Aislamiento por propietario en lecturas

Para todo conjunto de registros pertenecientes a varios Agentes, las consultas de listado realizadas por un Agente deben devolver únicamente registros cuyo propietario sea ese Agente, para cualquier tipo de entidad propia (Cliente, Registro_Actividad, Conversacion, Mensaje).

**Validates: Requirements 1.4, 7.5**

### Property 4: Round-trip de creación y lectura de cliente

Para todo cliente con nombre y correo electrónico válidos, crearlo y luego leerlo debe devolver un registro con los mismos valores en los campos proporcionados.

**Validates: Requirements 2.1**

### Property 5: Validación de entrada de cliente

Para toda entrada de cliente cuyo nombre o correo electrónico esté vacío, o cuyo correo electrónico no cumpla el formato de dirección de correo, la operación de creación o edición debe rechazarse con un error de validación y el estado almacenado debe permanecer sin cambios.

**Validates: Requirements 2.2, 2.3**

### Property 6: Round-trip de edición de cliente

Para todo cliente propio y toda actualización válida, leer el cliente tras editarlo debe reflejar exactamente los valores actualizados en los campos modificados.

**Validates: Requirements 2.4**

### Property 7: Eliminación en cascada de actividades

Para todo cliente propio con cualquier número de registros de actividad asociados, eliminar el cliente debe dar como resultado que no quede ningún registro de actividad asociado a ese cliente.

**Validates: Requirements 2.5**

### Property 8: Orden del listado de clientes por actividad reciente

Para todo conjunto de clientes propios, la secuencia devuelta por el listado debe estar ordenada de forma no creciente según la marca de tiempo de última actividad.

**Validates: Requirements 2.6**

### Property 9: Correctitud y completitud de la búsqueda

Para todo término de búsqueda y todo conjunto de clientes propios, el resultado debe contener exactamente los clientes cuyo nombre, correo electrónico o empresa contengan el término sin distinguir mayúsculas de minúsculas.

**Validates: Requirements 3.1**

### Property 10: Round-trip de creación de actividad

Para toda entrada de actividad con contenido no vacío sobre un cliente propio, crearla y luego leer las actividades del cliente debe incluir una entrada con el mismo contenido, una marca de tiempo y la asociación a ese cliente.

**Validates: Requirements 4.1**

### Property 11: Orden cronológico de actividades

Para todo conjunto de registros de actividad de un cliente, la secuencia mostrada debe estar ordenada de forma no decreciente según su marca de tiempo.

**Validates: Requirements 4.2**

### Property 12: Validación de contenido de actividad

Para todo contenido de actividad vacío o compuesto solo por espacios en blanco, la operación de creación debe rechazarse con un error de validación.

**Validates: Requirements 4.3**

### Property 13: El contexto enviado incluye el historial de la conversación

Para todo mensaje enviado dentro de una conversación, el contexto transmitido al Proveedor_Claude debe contener, en orden, los mensajes previos de esa conversación seguidos del nuevo mensaje.

**Validates: Requirements 5.1**

### Property 14: Integridad del texto transmitido y persistido

Para toda secuencia de tokens emitida por el Proveedor_Claude, el texto reensamblado a partir de los eventos transmitidos y el contenido del mensaje del asistente finalmente persistido deben ser ambos iguales a la concatenación de los tokens.

**Validates: Requirements 5.2, 5.4**

### Property 15: Acumulación incremental en la interfaz

Para toda secuencia de fragmentos recibidos, el estado de texto mostrado por la Interfaz_Chat tras procesar cada fragmento debe ser igual a la concatenación de todos los fragmentos recibidos hasta ese momento.

**Validates: Requirements 5.3**

### Property 16: Rechazo de mensajes vacíos del asistente

Para todo contenido de mensaje vacío o compuesto solo por espacios en blanco, el envío al asistente debe rechazarse con un error de validación y no debe invocarse al Proveedor_Claude.

**Validates: Requirements 5.5**

### Property 17: El contexto de cliente incluye sus datos

Para todo cliente propio sobre el que se solicita redactar o resumir, el contexto enviado al Proveedor_Claude debe incluir los datos de ese cliente, y además sus registros de actividad cuando la solicitud es de resumen.

**Validates: Requirements 6.1, 6.2**

### Property 18: Rechazo de referencia a cliente ajeno

Para todo cliente que no pertenece al Agente solicitante, toda solicitud del asistente que lo referencie debe rechazarse con un error de autorización y no debe invocarse al Proveedor_Claude con sus datos.

**Validates: Requirements 6.3**

### Property 19: Creación única de conversación en el primer mensaje

Para todo primer mensaje de una conversación nueva, debe crearse exactamente un registro de Conversacion asociado al Agente emisor.

**Validates: Requirements 7.1**

### Property 20: Round-trip de persistencia de mensaje

Para todo mensaje finalizado, leerlo de nuevo debe devolver el mismo rol, el mismo contenido y la misma conversación padre con los que fue persistido.

**Validates: Requirements 7.2**

### Property 21: Orden de recuperación de conversaciones y mensajes

Para todo conjunto de conversaciones de un Agente, la lista recuperada debe estar ordenada de forma no creciente por actividad reciente; y para toda conversación, sus mensajes deben cargarse en orden cronológico no decreciente.

**Validates: Requirements 7.3, 7.4**

### Property 22: Selección del modelo desde la configuración

Para todo valor definido en la variable de entorno del identificador de modelo, el Proveedor_Claude debe usar ese valor; y cuando no está definida, debe usar `claude-3-5-sonnet`.

**Validates: Requirements 8.1, 8.2**

### Property 23: Guarda por ausencia de clave de API

Para toda solicitud iniciada cuando la clave de API no está configurada, el backend debe devolver un error de configuración y no debe invocar al Proveedor_Claude.

**Validates: Requirements 8.5**

### Property 24: Preservación del mensaje del usuario ante error del modelo

Para todo error devuelto por el Proveedor_Claude, el mensaje enviado por el Agente debe permanecer persistido y debe devolverse un indicador de error a la Interfaz_Chat.

**Validates: Requirements 9.1**

### Property 25: Difusión a todos los destinos exactamente una vez

Para toda creación o actualización de cliente y toda Lista_Destinos_Salida no vacía, debe enviarse exactamente una solicitud HTTP POST por cada destino de la lista, y el cuerpo de cada solicitud debe contener el tipo de evento y la representación serializada del cliente.

**Validates: Requirements 10.1**

### Property 26: Resiliencia ante fallos por destino

Para toda creación o actualización de cliente y toda Lista_Destinos_Salida en la que un subconjunto arbitrario de destinos falle, el despachador debe intentar el envío a todos los destinos y nunca debe propagar una excepción, de modo que la operación de cliente se complete y persista con éxito.

**Validates: Requirements 10.4**

### Property 27: Omisión cuando no hay destinos configurados

Para toda creación o actualización de cliente cuando la Lista_Destinos_Salida está vacía, no debe enviarse ninguna solicitud HTTP y la operación de cliente debe completarse y persistirse con éxito.

**Validates: Requirements 10.3**

### Property 28: Compatibilidad hacia atrás con el webhook heredado

Para toda configuración en la que solo esté definido `ZAPIER_WEBHOOK_URL` (sin `OUTBOUND_WEBHOOK_URLS`), la Lista_Destinos_Salida resuelta debe contener exactamente esa única URL, y una creación o actualización de cliente debe enviarle exactamente una solicitud HTTP POST; además, la lista resuelta a partir de ambas fuentes debe estar siempre deduplicada.

**Validates: Requirements 10.2**

### Property 29: Creación de cliente desde entrada de Zapier válida

Para toda solicitud al Endpoint_Zapier_Entrada con un token válido y nombre y correo electrónico válidos, debe crearse y persistirse un registro de Cliente con esos datos.

**Validates: Requirements 11.1**

### Property 30: Autorización del endpoint de entrada

Para todo token distinto del Token_Integracion configurado, la solicitud al Endpoint_Zapier_Entrada debe rechazarse con un error de autorización (401) y no debe crearse ningún Cliente.

**Validates: Requirements 11.2**

### Property 31: Validación del endpoint de entrada

Para toda solicitud al Endpoint_Zapier_Entrada que omita el campo nombre o el campo correo electrónico, la solicitud debe rechazarse con un error de validación y no debe crearse ningún Cliente.

**Validates: Requirements 11.3**

### Property 32: Idempotencia de la semilla de la base de datos

Para todo número de ejecuciones de la Semilla_BD mayor o igual que uno, el resultado debe ser idéntico: debe existir exactamente un Cliente_Demo con nombre "Kepa Bilbao" asociado a un Agente propietario, sin registros duplicados.

**Validates: Requirements 13.1, 13.2**
