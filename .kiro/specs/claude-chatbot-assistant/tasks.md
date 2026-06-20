# Plan de Implementación: CRM de Clientes con Asistente Claude

## Visión General

El plan convierte el diseño en pasos de codificación incrementales sobre **Wasp + React + Node.js + Prisma** en **TypeScript**. Cada tarea construye sobre las anteriores y termina integrándose en el sistema, sin código huérfano. Las pruebas siguen un **enfoque dual**: pruebas por ejemplo/integración y pruebas basadas en propiedades (PBT, mínimo 100 iteraciones, con **Vitest** + **fast-check**) que referencian las 32 propiedades del diseño. Las llamadas a Anthropic y a los destinos de salida (Zapier, Make, n8n, HTTP propio) se mockean en las pruebas.

> Las sub-tareas marcadas con `*` son de pruebas y son opcionales (pueden omitirse para un MVP más rápido).

## Tareas

- [x] 1. Andamiaje del proyecto Wasp y configuración base
  - [x] 1.1 Inicializar el proyecto Wasp y declarar `app` y autenticación en `main.wasp`
    - Crear el proyecto Wasp en TypeScript y la estructura de carpetas `src/server` y `src/client`
    - Declarar `app clientCrm` con `auth` (userEntity `User`, método usernameAndPassword, `onAuthFailedRedirectTo: "/login"`)
    - Declarar páginas y rutas protegidas base (login, clientes, chat)
    - _Requisitos: 1.1_

  - [x] 1.2 Definir el esquema Prisma (entidades del dominio)
    - Definir entidades `User`, `Client`, `Activity`, `Conversation`, `Message` con campos, relaciones, `ownerId`, índices y `onDelete: Cascade` en `Activity` y `Message`
    - Declarar las entidades en `main.wasp` y generar la migración inicial
    - _Requisitos: 2.1, 4.1, 7.1, 7.2_

  - [x] 1.3 Configurar variables de entorno y exclusión del control de versiones
    - Crear `.env.example` con `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `OUTBOUND_WEBHOOK_URLS`, `ZAPIER_WEBHOOK_URL`, `ZAPIER_INBOUND_TOKEN` vacías
    - Añadir `.env` a `.gitignore`
    - _Requisitos: 8.3, 8.4, 10.2, 11.4_

- [x] 2. Gestor de configuración
  - [x] 2.1 Implementar `server/config.ts`
    - Exponer lectores de `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (por defecto `claude-3-5-sonnet`), `OUTBOUND_WEBHOOK_URLS` (lista separada por comas o espacios), `ZAPIER_WEBHOOK_URL` y `ZAPIER_INBOUND_TOKEN` leídos en tiempo de ejecución desde `.env`
    - _Requisitos: 8.1, 8.2, 10.2, 11.4_

  - [x]* 2.2 Escribir prueba de propiedad para la selección de modelo
    - **Property 22: Selección del modelo desde la configuración**
    - **Validates: Requirements 8.1, 8.2**

- [x] 3. Capa de autenticación y aislamiento por propietario
  - [x] 3.1 Implementar `server/auth/ownership.ts`
    - Implementar `requireUser(context)` (lanza 401 sin sesión) y `requireOwnership(record, ownerId)` (lanza 403 ante registro ajeno o inexistente)
    - _Requisitos: 1.2, 1.3, 1.4_

  - [x]* 3.2 Escribir pruebas de propiedad para autenticación y aislamiento
    - **Property 1: Rechazo de solicitudes no autenticadas**
    - **Property 3: Aislamiento por propietario en lecturas**
    - **Validates: Requirements 1.2, 1.4, 7.5**

- [x] 4. Gestión de clientes (CRUD, validación y búsqueda)
  - [x] 4.1 Implementar validación de entrada de cliente
    - Implementar `validateClientInput` (nombre y correo obligatorios; regex de formato de correo) en `server/clients/validation.ts`
    - _Requisitos: 2.2, 2.3_

  - [x] 4.2 Implementar acciones de cliente en `server/clients/actions.ts`
    - Implementar `createClient`, `updateClient` (con `requireOwnership` y `lastActivityAt`), `deleteClient` (transacción con eliminación de `Activity`)
    - Asociar `ownerId` en cada creación
    - _Requisitos: 2.1, 2.4, 2.5, 1.3_

  - [x] 4.3 Implementar consultas de cliente en `server/clients/queries.ts`
    - Implementar `getClients` (filtrado por `ownerId`, orden por `lastActivityAt desc`), `getClient` (con verificación de propiedad) y `searchClients` (OR case-insensitive sobre name/email/company)
    - _Requisitos: 2.6, 3.1, 1.4_

  - [x]* 4.4 Escribir pruebas de propiedad para CRUD de clientes
    - **Property 2: Asociación del propietario al crear registros**
    - **Property 4: Round-trip de creación y lectura de cliente**
    - **Property 5: Validación de entrada de cliente**
    - **Property 6: Round-trip de edición de cliente**
    - **Property 7: Eliminación en cascada de actividades**
    - **Property 8: Orden del listado de clientes por actividad reciente**
    - **Validates: Requirements 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

  - [x]* 4.5 Escribir prueba de propiedad para la búsqueda
    - **Property 9: Correctitud y completitud de la búsqueda**
    - **Validates: Requirements 3.1**

- [x] 5. Registro de actividad y notas por cliente
  - [x] 5.1 Implementar actividad en `server/clients/actions.ts` y `queries.ts`
    - Implementar `addActivity` (valida contenido no vacío, crea `Activity` con marca de tiempo, actualiza `lastActivityAt` del cliente)
    - Extender `getClient` para devolver las `Activity` en orden cronológico
    - _Requisitos: 4.1, 4.2, 4.3_

  - [x]* 5.2 Escribir pruebas de propiedad para actividad
    - **Property 10: Round-trip de creación de actividad**
    - **Property 11: Orden cronológico de actividades**
    - **Property 12: Validación de contenido de actividad**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 6. Checkpoint - Asegurar que las pruebas pasan
  - Asegurar que todas las pruebas pasan; preguntar al usuario si surgen dudas.

- [x] 7. Proveedor de Claude (integración con Anthropic)
  - [x] 7.1 Implementar `server/chat/claudeProvider.ts`
    - Integrar el SDK `@anthropic-ai/sdk`; `streamCompletion` como async generator de tokens; usar modelo desde config; lanzar error 500 si falta la clave de API antes de invocar
    - _Requisitos: 5.1, 5.2, 8.5_

  - [x]* 7.2 Escribir prueba de propiedad para la guarda de clave de API
    - **Property 23: Guarda por ausencia de clave de API**
    - **Validates: Requirements 8.5**

- [x] 8. Constructor de contexto del asistente
  - [x] 8.1 Implementar `server/chat/context.ts`
    - `buildContext` que arma historial + preámbulo con datos del cliente (y actividades para resumen) y `serializeClient`
    - _Requisitos: 5.1, 6.1, 6.2_

  - [x]* 8.2 Escribir pruebas de propiedad para el contexto
    - **Property 13: El contexto enviado incluye el historial de la conversación**
    - **Property 17: El contexto de cliente incluye sus datos**
    - **Validates: Requirements 5.1, 6.1, 6.2**

- [x] 9. Persistencia y recuperación de conversaciones
  - [x] 9.1 Implementar consultas de chat en `server/chat/queries.ts`
    - `getConversations` (filtrado por `ownerId`, orden por actividad reciente) y `getMessages` (con verificación de propiedad, orden cronológico)
    - Utilidades `loadHistory`, `getConv` para el endpoint de stream
    - _Requisitos: 7.3, 7.4, 7.5_

  - [x]* 9.2 Escribir pruebas de propiedad para recuperación de conversaciones
    - **Property 21: Orden de recuperación de conversaciones y mensajes**
    - **Validates: Requirements 7.3, 7.4**

- [x] 10. Endpoint SSE del asistente (`chatStream`)
  - [x] 10.1 Implementar `server/chat/stream.ts` y declararlo como `api` en `main.wasp`
    - Validar sesión y contenido no vacío; crear `Conversation` en el primer mensaje; verificar propiedad de cliente para draft/summary; persistir mensaje del usuario; transmitir tokens vía SSE; persistir mensaje del asistente al completar; emitir evento `error` y conservar el mensaje del usuario ante fallo
    - Integrar `Proveedor_Claude`, `Constructor_Contexto` y las consultas de chat
    - _Requisitos: 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 7.1, 7.2, 9.1, 9.2_

  - [x]* 10.2 Escribir pruebas de propiedad para el flujo de chat
    - **Property 14: Integridad del texto transmitido y persistido**
    - **Property 16: Rechazo de mensajes vacíos del asistente**
    - **Property 18: Rechazo de referencia a cliente ajeno**
    - **Property 19: Creación única de conversación en el primer mensaje**
    - **Property 20: Round-trip de persistencia de mensaje**
    - **Property 24: Preservación del mensaje del usuario ante error del modelo**
    - **Validates: Requirements 5.2, 5.4, 5.5, 6.3, 7.1, 7.2, 9.1**

- [x] 11. Checkpoint - Asegurar que las pruebas pasan
  - Asegurar que todas las pruebas pasan; preguntar al usuario si surgen dudas.

- [x] 12. Capa de automatización de salida multi-destino
  - [x] 12.1 Implementar la Capa_Salida genérica y la fachada de compatibilidad, y conectarla a las acciones de cliente
    - Implementar `server/integrations/outbound.ts`: `resolverDestinos()` (combina `config.outboundWebhookUrls()` y el `ZAPIER_WEBHOOK_URL` heredado, deduplicando) y `notificarClienteEvento(client, event)` (fan-out POST en paralelo a todos los destinos; omite si la lista está vacía; aísla y registra fallos por destino sin propagar la excepción)
    - Añadir `config.outboundWebhookUrls()` en `server/config.ts` (lee `OUTBOUND_WEBHOOK_URLS`, separadas por comas o espacios)
    - Conservar `server/integrations/zapierOutbound.ts` como fachada compatible hacia atrás (`notificarCliente` delega en `notificarClienteEvento`)
    - Cablear `createClient` y `updateClient` en `server/clients/actions.ts` para invocar `notificarClienteEvento(client, 'created' | 'updated')`
    - _Requisitos: 10.1, 10.2, 10.3, 10.4_

  - [x]* 12.2 Escribir pruebas de propiedad para la automatización de salida
    - **Property 25: Difusión a todos los destinos exactamente una vez**
    - **Property 26: Resiliencia ante fallos por destino**
    - **Property 27: Omisión cuando no hay destinos configurados**
    - **Property 28: Compatibilidad hacia atrás con el webhook heredado**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [x] 13. Integración de entrada con Zapier
  - [x] 13.1 Implementar `server/integrations/zapierInbound.ts` y declararlo como `api`
    - Validar `Token_Integracion`; validar nombre y correo; crear y persistir `Client`; responder 201/401/400 según corresponda
    - _Requisitos: 11.1, 11.2, 11.3, 11.4_

  - [x]* 13.2 Escribir pruebas de propiedad para el endpoint de entrada
    - **Property 29: Creación de cliente desde entrada de Zapier válida**
    - **Property 30: Autorización del endpoint de entrada**
    - **Property 31: Validación del endpoint de entrada**
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [x] 14. Semilla inicial de la base de datos
  - [x] 14.1 Implementar `server/seeds.ts` y cablearla en `main.wasp`
    - Implementar `seedKepaBilbao(prisma)`: garantizar un Usuario propietario (reutilizar el primero o crear uno mínimo); crear el Cliente_Demo "Kepa Bilbao" asociado al propietario; idempotencia identificando el Cliente_Demo por su correo de marcador y omitiendo la creación si ya existe
    - Declarar `seedKepaBilbao` en `main.wasp` bajo `app.db.seeds`
    - _Requisitos: 13.1, 13.2_

  - [x]* 14.2 Escribir prueba de propiedad para la idempotencia de la semilla
    - **Property 32: Idempotencia de la semilla de la base de datos**
    - **Validates: Requirements 13.1, 13.2**

- [x] 15. Interfaz de usuario en español
  - [x] 15.1 Crear el catálogo de cadenas `client/i18n/es.ts`
    - Centralizar etiquetas, botones y mensajes de estado/validación en español
    - _Requisitos: 12.1, 12.2_

  - [x] 15.2 Implementar `PaginaClientes` con listado y búsqueda
    - Consumir `getClients`/`searchClients`; ordenar por actividad reciente; mostrar mensaje "No se encontraron resultados" cuando no haya coincidencias
    - _Requisitos: 2.6, 3.1, 3.2, 12.1_

  - [x] 15.3 Implementar `FormularioCliente`
    - Crear/editar clientes; mostrar mensajes de validación en español
    - _Requisitos: 2.1, 2.4, 12.2_

  - [x] 15.4 Implementar `DetalleCliente`
    - Mostrar campos del cliente y actividades en orden cronológico; añadir notas; disparar acciones de redactar/resumir del asistente
    - _Requisitos: 4.2, 6.1, 6.2_

  - [x] 15.5 Implementar `InterfazChat` con streaming SSE
    - Listar conversaciones del agente; cargar mensajes; abrir conexión SSE; aplicar reducer de acumulación incremental de tokens; mostrar mensaje de error en español ante evento `error`
    - _Requisitos: 5.3, 7.3, 7.4, 9.3, 12.1_

  - [x]* 15.6 Escribir prueba de propiedad para la acumulación incremental
    - **Property 15: Acumulación incremental en la interfaz**
    - **Validates: Requirements 5.3**

  - [x]* 15.7 Escribir pruebas por ejemplo del idioma de la UI y del manejo de errores
    - Verificar que los componentes renderizan etiquetas/mensajes en español y que la `InterfazChat` muestra error en español
    - _Requisitos: 9.3, 12.1, 12.2_

- [x] 16. Cableado final y checkpoint
  - [x] 16.1 Integrar todas las operaciones, páginas y endpoints en `main.wasp`
    - Verificar que queries, actions y endpoints `api` están declarados con sus entidades; rutas protegidas activas; semilla `app.db.seeds` declarada; smoke de configuración de `.env`
    - _Requisitos: 1.1, 8.3, 8.4, 10.2, 11.4, 13.1_

- [x] 17. Checkpoint final - Asegurar que las pruebas pasan
  - Asegurar que todas las pruebas pasan; preguntar al usuario si surgen dudas.

## Notas

- Las sub-tareas con `*` son pruebas opcionales y pueden omitirse para un MVP más rápido.
- Cada tarea referencia requisitos específicos para trazabilidad y, cuando aplica, propiedades del diseño.
- Las pruebas basadas en propiedades usan Vitest + fast-check (mínimo 100 iteraciones) y referencian las propiedades del diseño.
- Las pruebas que tocan Anthropic y los destinos de salida usan mocks de `Proveedor_Claude` y de `fetch`.
- Los checkpoints garantizan validación incremental en puntos de corte razonables.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.2", "4.3", "7.1"] },
    { "id": 4, "tasks": ["4.4", "4.5", "5.1", "7.2", "8.1", "9.1"] },
    { "id": 5, "tasks": ["5.2", "8.2", "9.2", "10.1", "12.1", "13.1", "14.1", "15.1"] },
    { "id": 6, "tasks": ["10.2", "12.2", "13.2", "14.2", "15.2", "15.3", "15.4", "15.5"] },
    { "id": 7, "tasks": ["15.6", "15.7", "16.1"] }
  ]
}
```
