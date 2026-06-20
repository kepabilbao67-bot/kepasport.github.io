# CRM de Clientes con Asistente Claude

CRM de clientes construido sobre [Wasp](https://wasp.sh) (React + Node.js + Prisma, todo en TypeScript) con un asistente de IA basado en **Claude (Anthropic)** y **automatización de salida genérica** hacia cualquier sistema externo (Zapier, Make, n8n o un endpoint HTTP propio).

El asistente responde en streaming token a token mediante Server-Sent Events (SSE), puede redactar y resumir información de clientes, y todas las conversaciones quedan persistidas. La interfaz de usuario está íntegramente en español.

## Características principales

- **Autenticación y aislamiento por propietario**: cada Agente (usuario) solo ve y gestiona sus propios clientes y conversaciones.
- **CRUD de clientes + búsqueda + actividad/notas**: alta, edición, borrado y consulta de clientes, búsqueda y registro de actividad/notas por cliente.
- **Asistente Claude con streaming SSE token a token**: las respuestas se transmiten en tiempo real a medida que el modelo las genera.
- **Redactar / resumir cliente**: el asistente puede redactar mensajes y resumir la información de un cliente.
- **Persistencia de conversaciones**: los hilos de conversación y sus mensajes se almacenan y se pueden recuperar.
- **Automatización de salida multi-destino**: notifica eventos a uno o varios destinos (Zapier, Make, n8n, HTTP propio) mediante webhooks.
- **Endpoint de entrada de Zapier**: permite que sistemas externos creen clientes vía REST de forma segura.
- **UI en español**: toda la interfaz y los mensajes están en español.

## Requisitos previos

- **Node.js** (versión LTS recomendada).
- **Wasp CLI** — consulta la guía de instalación: <https://wasp.sh/docs/quick-start>.
- **Base de datos PostgreSQL** — en desarrollo, Wasp puede arrancar y gestionar la suya automáticamente.
- **Clave de API de Anthropic** — necesaria para que funcione el asistente Claude.

## Configuración

Copia el archivo de ejemplo de variables de entorno del servidor y rellena los valores:

```bash
cp .env.server.example .env.server
```

Variables disponibles en `.env.server`:

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Sí | Clave de API de Anthropic. Si falta, el asistente devuelve un error de configuración. |
| `CLAUDE_MODEL` | No | Identificador del modelo de Claude. Por defecto: `claude-3-5-sonnet`. |
| `OUTBOUND_WEBHOOK_URLS` | No | Lista de destinos de salida separados por comas (y/o espacios). Permite notificar a cualquier sistema externo: Zapier, Make, n8n o un endpoint HTTP propio. |
| `ZAPIER_WEBHOOK_URL` | No | URL del webhook de salida de Zapier (se conserva por compatibilidad; también se incluye en la lista de destinos). |
| `ZAPIER_INBOUND_TOKEN` | Para entrada | Token que protege el endpoint de entrada de Zapier. Si falta, se rechazan todas las solicitudes entrantes. |

Ejemplo de `OUTBOUND_WEBHOOK_URLS` con varios destinos (Make y n8n):

```
OUTBOUND_WEBHOOK_URLS=https://hook.make.com/abc,https://n8n.midominio.com/webhook/xyz
```

## Puesta en marcha

```bash
# 1. Aplica las migraciones de la base de datos
wasp db migrate-dev

# 2. Siembra los datos iniciales (crea el cliente "Kepa Bilbao")
wasp db seed

# 3. Arranca la aplicación (cliente + servidor)
wasp start
```

La semilla es idempotente: si el cliente "Kepa Bilbao" ya existe (identificado por su correo electrónico), no se vuelve a crear.

## Pruebas

Las pruebas usan **Vitest** + **fast-check** (pruebas basadas en propiedades). Se ejecutan con:

```bash
npx vitest run
```

> **Nota:** en algunos entornos es necesario limpiar `NODE_OPTIONS` antes de ejecutar las pruebas:
>
> ```bash
> env -u NODE_OPTIONS npx vitest run
> ```

Además de las pruebas unitarias, el proyecto incluye **pruebas basadas en propiedades** (`*.property.test.ts`) que cubren las propiedades de corrección definidas en el documento de diseño (aislamiento por propietario, validación de clientes, ensamblado del contexto, reducción del stream SSE, despacho de salida, etc.).

## Endpoints de integración

### `POST /api/chat/stream`

Endpoint **SSE** del asistente. Requiere **sesión autenticada** de Wasp (`auth: true`). Transmite la respuesta de Claude token a token mediante Server-Sent Events y persiste el hilo de conversación (entidades `Conversation` y `Message`), con acceso a `Client`/`Activity` para redactar y resumir.

### `POST /api/integrations/zapier/clients`

Endpoint de **entrada** que permite crear clientes desde sistemas externos sin sesión de Wasp (`auth: false`). La autenticación se realiza por token mediante la cabecera `X-Zapier-Token` (o el campo `token` en el cuerpo), validado contra `ZAPIER_INBOUND_TOKEN`.

- `name` y `email` son obligatorios; si faltan, responde `400`.
- Token inválido o ausente: responde `401`.
- Éxito: responde `201` con la representación del cliente creado.

Ejemplo de solicitud:

```bash
curl -X POST https://tu-dominio/api/integrations/zapier/clients \
  -H "Content-Type: application/json" \
  -H "X-Zapier-Token: TU_TOKEN_DE_ENTRADA" \
  -d '{
    "name": "Ana García",
    "email": "ana.garcia@example.com",
    "phone": "+34 600 111 222",
    "company": "García & Asociados",
    "status": "prospecto",
    "notes": "Contacto recibido desde el formulario web."
  }'
```

## Estructura del proyecto

```
src/
├── server/                 # Backend (Node.js + Prisma)
│   ├── auth/               # Aislamiento y verificación de propiedad (ownership)
│   ├── clients/            # CRUD, búsqueda, actividad y validación de clientes
│   │   ├── actions.ts      # createClient, updateClient, deleteClient, addActivity
│   │   ├── queries.ts      # getClients, getClient, searchClients
│   │   └── validation.ts
│   ├── chat/               # Asistente Claude: proveedor, contexto, stream SSE y queries
│   │   ├── claudeProvider.ts
│   │   ├── context.ts
│   │   ├── stream.ts       # Endpoint SSE chatStream
│   │   └── queries.ts      # getConversations, getMessages
│   ├── integrations/       # Automatización de salida (genérica/Zapier) y entrada de Zapier
│   ├── config.ts           # Lectura centralizada de variables de entorno
│   └── seeds.ts            # Semilla inicial ("Kepa Bilbao")
└── client/                 # Frontend (React)
    ├── auth/               # Páginas de login y registro
    ├── clients/            # Listado, formulario y detalle de clientes
    ├── chat/               # Interfaz de chat y reductor del stream
    └── i18n/               # Textos en español (es.ts)
```

### Entidades del dominio

- `User` — Agente propietario; gestiona sus clientes y conversaciones.
- `Client` — cliente del CRM (nombre, email, teléfono, empresa, estado, notas).
- `Activity` — registro de actividad/notas asociado a un cliente.
- `Conversation` — hilo de conversación del asistente.
- `Message` — mensaje individual (`user` | `assistant`) dentro de una conversación.

### Operaciones de Wasp

- **Queries**: `getClients`, `getClient`, `searchClients`, `getConversations`, `getMessages`.
- **Actions**: `createClient`, `updateClient`, `deleteClient`, `addActivity`.

## Especificación (spec)

El diseño detallado de la funcionalidad del asistente está en `.kiro/specs/claude-chatbot-assistant/`:

- `requirements.md` — requisitos.
- `design.md` — diseño técnico y propiedades de corrección.
- `tasks.md` — plan de tareas de implementación.
