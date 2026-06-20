# Documento de Diseño: Publicador de Vídeos IA

## Visión general

"Publicador de Vídeos IA" se construye **dentro de la misma aplicación Wasp** que ya
contiene el CRM de clientes. No introduce un proyecto, un servidor ni una capa de
autenticación nuevos: reutiliza la infraestructura existente de forma **aditiva**.

El producto permite a un Usuario autenticado:

1. Crear una **Publicacion_Video** (`VideoPost`) indicando una URL de vídeo, un
   `brief` y un conjunto de plataformas objetivo.
2. Generar, con el **Asistente_IA** basado en Claude, el contenido adaptado a
   cada plataforma (título, descripción y hashtags) — un **Contenido_Plataforma**
   (`PlatformContent`) por plataforma.
3. Publicar las plataformas automatizadas a través de la **capa genérica de
   automatización de salida** (`OUTBOUND_WEBHOOK_URLS`) y copiar el texto de las
   plataformas manuales (Fiverr).

El diseño se apoya en tres piezas ya presentes en el repositorio, que se reutilizan
sin reescribirse:

| Capacidad | Pieza existente reutilizada |
|---|---|
| Autenticación + aislamiento por propietario | Wasp `auth` (entidad `User`) y `src/server/auth/ownership.ts` (`requireUser`, `requireOwnership`) |
| Integración con Claude | `src/server/chat/claudeProvider.ts` (`streamCompletion`) y `src/server/config.ts` (`anthropicApiKey`, `claudeModel`) |
| Automatización de salida | `src/server/integrations/outbound.ts` (`resolverDestinos`) y `config.outboundWebhookUrls()` |

### Principios de diseño

- **Aditivo, no destructivo**: todas las declaraciones del CRM en `main.wasp`
  (entidades `Client`, `Activity`, `Conversation`, `Message`, sus consultas,
  acciones, rutas y APIs) permanecen intactas. El publicador solo **añade**
  entidades, operaciones, rutas y páginas nuevas.
- **Reutilización de la guarda de propiedad**: toda operación de escritura/lectura
  pasa por `requireUser`/`requireOwnership`.
- **Reutilización de la guarda de clave de API**: la generación con Claude
  comparte la misma comprobación de `config.anthropicApiKey()` que el chat
  (HttpError 500 si falta).
- **Reutilización del despachador de salida**: la publicación reutiliza
  `resolverDestinos()` para construir la lista deduplicada de destinos.
- **Interfaz y mensajes en español**, consumiendo el catálogo central
  `src/client/i18n/es.ts` (extendido con claves nuevas).

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Navegador (React, español)                      │
│                                                                        │
│  PaginaPublicaciones   FormularioPublicacion   DetallePublicacion      │
│   (listado)             (creación)              (variantes/plataforma) │
│        │                     │                        │                │
│        │  useQuery/useAction (operaciones de Wasp)     │               │
└────────┼─────────────────────┼────────────────────────┼───────────────┘
         │                     │                        │
┌────────▼─────────────────────▼────────────────────────▼───────────────┐
│                    Backend_Publicador (Wasp / Node.js)                 │
│                                                                        │
│  queries:  getVideoPosts · getVideoPost                                │
│  actions:  createVideoPost · generatePlatformContent ·                 │
│            publishPlatformContent · markManual                         │
│        │              │                    │                           │
│        │  requireUser/requireOwnership  ◄──┼── src/server/auth/        │
│        │              │                    │      ownership.ts (REUSO)  │
│  ┌─────▼─────┐  ┌──────▼─────────┐   ┌──────▼──────────────┐            │
│  │ Prisma    │  │ aiContent.ts   │   │ publisher dispatcher │           │
│  │ VideoPost │  │ generateText() │   │ publicarEnDestinos() │           │
│  │ Platform  │  │ generateContent│   │   (REUSA             │           │
│  │  Content  │  │  ForPlatform() │   │   resolverDestinos)  │           │
│  └───────────┘  └──────┬─────────┘   └──────┬──────────────┘            │
│                        │                    │                           │
└────────────────────────┼────────────────────┼──────────────────────────┘
                         │                    │
              ┌──────────▼─────────┐   ┌───────▼──────────────────────┐
              │ claudeProvider.ts  │   │ OUTBOUND_WEBHOOK_URLS         │
              │ streamCompletion   │   │ (Make / n8n / HTTP propio)    │
              │ (REUSO) + config   │   │ vía fetch POST Carga_Public.  │
              └──────────┬─────────┘   └──────────────────────────────┘
                        │
                ┌────────▼────────┐
                │ Anthropic Claude │
                └─────────────────┘
```

La generación de contenido **no** transmite tokens al usuario (a diferencia del
chat): necesita el texto completo para parsearlo en `{ title, description,
hashtags }`. Por ello se introduce un ayudante **no-streaming** `generateText`
que **consume** el async generator `streamCompletion` existente y ensambla la
cadena completa, reutilizando así la misma guarda de clave y selección de modelo.

## Configuración de Wasp (main.wasp) — adiciones

Las siguientes declaraciones se **añaden** a `main.wasp`. No se modifica ni se
elimina ninguna declaración del CRM existente.

### Relación en la entidad User (aditiva)

La entidad `User` existente añade una relación inversa hacia `VideoPost`:

```psl
entity User {=psl
  id            Int            @id @default(autoincrement())
  clients       Client[]
  conversations Conversation[]
  videoPosts    VideoPost[]        // NUEVO (aditivo)
psl=}
```

### Nuevas entidades

```psl
entity VideoPost {=psl
  id          Int               @id @default(autoincrement())
  videoUrl    String
  fileRef     String?
  brief       String
  ownerId     Int
  owner       User              @relation(fields: [ownerId], references: [id])
  contents    PlatformContent[]
  createdAt   DateTime          @default(now())

  @@index([ownerId])
psl=}

entity PlatformContent {=psl
  id          Int       @id @default(autoincrement())
  videoPostId Int
  videoPost   VideoPost @relation(fields: [videoPostId], references: [id], onDelete: Cascade)
  platform    String    // "linkedin" | "instagram" | "youtube" | "x" | "tiktok" | "fiverr"
  title       String    @default("")
  description String    @default("")
  hashtags    String    @default("")   // hashtags serializados separados por espacios
  status      String    @default("pendiente") // "pendiente" | "enviado" | "error" | "manual"
  createdAt   DateTime  @default(now())

  @@index([videoPostId])
psl=}
```

### Nuevas consultas

```wasp
query getVideoPosts {
  fn: import { getVideoPosts } from "@src/server/publisher/queries.js",
  entities: [VideoPost]
}

query getVideoPost {
  fn: import { getVideoPost } from "@src/server/publisher/queries.js",
  entities: [VideoPost, PlatformContent]
}
```

### Nuevas acciones

```wasp
action createVideoPost {
  fn: import { createVideoPost } from "@src/server/publisher/actions.js",
  entities: [VideoPost, PlatformContent]
}

action generatePlatformContent {
  fn: import { generatePlatformContent } from "@src/server/publisher/actions.js",
  entities: [VideoPost, PlatformContent]
}

action publishPlatformContent {
  fn: import { publishPlatformContent } from "@src/server/publisher/actions.js",
  entities: [VideoPost, PlatformContent]
}

action markManual {
  fn: import { markManual } from "@src/server/publisher/actions.js",
  entities: [VideoPost, PlatformContent]
}
```

### Nuevas rutas y páginas (protegidas)

```wasp
route PublicacionesRoute { path: "/publicaciones", to: PaginaPublicaciones }
page PaginaPublicaciones {
  authRequired: true,
  component: import { PaginaPublicaciones } from "@src/client/publisher/PaginaPublicaciones.tsx"
}

route NuevaPublicacionRoute { path: "/publicaciones/nueva", to: NuevaPublicacionPage }
page NuevaPublicacionPage {
  authRequired: true,
  component: import { FormularioPublicacion } from "@src/client/publisher/FormularioPublicacion.tsx"
}

route DetallePublicacionRoute { path: "/publicaciones/:id", to: DetallePublicacionPage }
page DetallePublicacionPage {
  authRequired: true,
  component: import { DetallePublicacion } from "@src/client/publisher/DetallePublicacion.tsx"
}
```

> `authRequired: true` satisface el Requisito 1.1 (acceso solo a sesiones
> autenticadas), igual que las páginas existentes del CRM.

## Modelos de datos (Prisma)

### VideoPost (Publicacion_Video)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int (PK) | Autoincremental |
| `videoUrl` | String | URL de la Fuente_Video (obligatoria, Req 2.1/2.3) |
| `fileRef` | String? | Referencia opcional a archivo subido (Req 2.2) |
| `brief` | String | Resumen del tema (Req 2.1) |
| `ownerId` | Int (FK→User) | Propietario; índice `@@index([ownerId])` (Req 1.3) |
| `createdAt` | DateTime | Orden del listado descendente (Req 4.1) |
| `contents` | PlatformContent[] | Variantes por plataforma |

### PlatformContent (Contenido_Plataforma)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int (PK) | Autoincremental |
| `videoPostId` | Int (FK→VideoPost) | `onDelete: Cascade` evita huérfanos |
| `platform` | String | Clave de plataforma (ver mapa de plataformas) |
| `title` | String | Título/encabezado generado |
| `description` | String | Descripción/texto generado |
| `hashtags` | String | Hashtags serializados (separados por espacios) |
| `status` | String | `pendiente` \| `enviado` \| `error` \| `manual` (Req 5.x, 6.3) |
| `createdAt` | DateTime | Marca de creación |

Se usan campos `String` para `platform` y `status` (no enums Prisma) por
coherencia con el patrón existente del CRM (`Client.status` es `String`), lo que
simplifica la persistencia y las pruebas.

## Estrategia de prompts por plataforma

Un mapa central `platformGuides` define, por cada plataforma, su tono, sus
límites y su clasificación automatizada/manual. El prompt de Claude se construye
combinando la guía de la plataforma con el `brief` y la `videoUrl`.

```typescript
// src/server/publisher/platforms.ts
export type Platform =
  | 'linkedin' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'fiverr'

export type PlatformKind = 'automatizada' | 'manual'

export interface PlatformGuide {
  label: string          // etiqueta en español para la interfaz
  kind: PlatformKind     // automatizada (vía webhook) o manual (copiar)
  tone: string           // guía de tono incluida en el prompt
  limits: string         // guía de límites/longitud incluida en el prompt
}

export const platformGuides: Record<Platform, PlatformGuide> = {
  linkedin:  { label: 'LinkedIn',  kind: 'automatizada',
               tone: 'profesional y orientado a negocio',
               limits: 'texto medio, 1-3 hashtags relevantes' },
  instagram: { label: 'Instagram', kind: 'automatizada',
               tone: 'informal y cercano',
               limits: 'descripción breve con varios hashtags' },
  youtube:   { label: 'YouTube',   kind: 'automatizada',
               tone: 'descriptivo y claro',
               limits: 'título atractivo + descripción extensa' },
  x:         { label: 'X/Twitter', kind: 'automatizada',
               tone: 'directo y conciso',
               limits: 'texto muy breve (<= 280 caracteres)' },
  tiktok:    { label: 'TikTok',    kind: 'automatizada',
               tone: 'informal y dinámico',
               limits: 'descripción corta con hashtags de tendencia' },
  fiverr:    { label: 'Fiverr',    kind: 'manual',
               tone: 'estilo anuncio de servicio (gig)',
               limits: 'título de servicio + descripción de oferta' },
}

export const PLATAFORMAS: Platform[] = Object.keys(platformGuides) as Platform[]

export function esManual(p: Platform): boolean {
  return platformGuides[p].kind === 'manual'
}
```

> **Fiverr** es la única `Plataforma_Manual` en el MVP. Cualquier plataforma sin
> destino de salida disponible se trata también como manual en tiempo de
> publicación (ver Requisito 5.5).

## Capa de IA: aiContent.ts

```typescript
// src/server/publisher/aiContent.ts
import { HttpError } from 'wasp/server'
import { config } from '../config.js'
import { streamCompletion } from '../chat/claudeProvider.js'
import { platformGuides, type Platform } from './platforms.js'

export interface ContenidoGenerado {
  title: string
  description: string
  hashtags: string
}

/**
 * Ayudante NO-streaming: reutiliza streamCompletion y ensambla el texto
 * completo. La guarda de clave de API vive dentro de streamCompletion, que
 * lanza HttpError(500) si falta ANTHROPIC_API_KEY (Req 3.5, 7.3, 8.3).
 */
export async function generateText(prompt: string): Promise<string> {
  let texto = ''
  for await (const token of streamCompletion([{ role: 'user', content: prompt }])) {
    texto += token
  }
  return texto
}

/** Construye el prompt incluyendo la guía de tono/límites de la plataforma (Req 3.2). */
export function buildPrompt(brief: string, videoUrl: string, platform: Platform): string {
  const g = platformGuides[platform]
  return [
    `Genera contenido para la plataforma ${g.label}.`,
    `Tono: ${g.tone}. Límites: ${g.limits}.`,
    `Vídeo: ${videoUrl}`,
    `Resumen del tema: ${brief}`,
    'Devuelve un JSON con las claves "title", "description" y "hashtags".',
  ].join('\n')
}

/** Genera y parsea el contenido por plataforma (Req 3.1, 3.2, 3.3). */
export async function generateContentForPlatform(
  brief: string,
  videoUrl: string,
  platform: Platform
): Promise<ContenidoGenerado> {
  const prompt = buildPrompt(brief, videoUrl, platform)
  const salida = await generateText(prompt)
  return parseContenido(salida)
}
```

`parseContenido` interpreta la respuesta de Claude. Es tolerante: intenta
`JSON.parse`; si falla, recurre a una extracción por secciones y siempre devuelve
los tres campos (cadenas vacías como respaldo) para mantener la forma estable.

## Flujo de publicación

### Forma de la Carga_Publicacion

```json
{
  "platform": "linkedin",
  "videoUrl": "https://...",
  "content": {
    "title": "…",
    "description": "…",
    "hashtags": "#a #b"
  }
}
```

### Despachador de salida generalizado

```typescript
// src/server/publisher/dispatch.ts
import { resolverDestinos } from '../integrations/outbound.js'

export interface CargaPublicacion {
  platform: string
  videoUrl: string
  content: { title: string; description: string; hashtags: string }
}

export interface ResultadoEnvio { total: number; fallidos: number }

/**
 * Difunde la Carga_Publicacion a TODOS los destinos resueltos (REUSA
 * resolverDestinos), con aislamiento de fallo por destino (Req 5.1, 5.4).
 * Devuelve el recuento para que la acción decida el Estado_Publicacion.
 */
export async function publicarEnDestinos(
  carga: CargaPublicacion
): Promise<ResultadoEnvio> {
  const destinos = resolverDestinos()
  const body = JSON.stringify(carga)
  let fallidos = 0
  await Promise.all(
    destinos.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        if (!res.ok) fallidos++
      } catch (err) {
        fallidos++
        console.error(`Fallo al publicar en destino (${url}):`, err)
      }
    })
  )
  return { total: destinos.length, fallidos }
}
```

### Transiciones de Estado_Publicacion

```
                 crear publicación
                        │
                        ▼
                   ┌──────────┐   plataforma manual (Fiverr)   ┌────────┐
                   │ pendiente│ ─────────────────────────────► │ manual │
                   └────┬─────┘                                 └────────┘
       publicar (auto)  │
        destinos vacíos │────────────────────────────────────► manual (Req 5.5)
                        │
            todos OK    │────────────────────────────────────► enviado (Req 5.3)
                        │
       algún fallo      │────────────────────────────────────► error  (Req 5.4)
```

`publishPlatformContent` (acción):

1. `requireUser` + `requireOwnership` sobre la `VideoPost` dueña del
   `PlatformContent` (Req 1.5).
2. Construye la `Carga_Publicacion`.
3. Llama a `publicarEnDestinos`.
   - `total === 0` → estado `manual` (Req 5.5).
   - `fallidos === 0` → estado `enviado` (Req 5.3).
   - `fallidos > 0` → estado `error` (Req 5.4), pero todos los destinos se
     intentaron (resiliencia).
4. Persiste el nuevo estado vía Prisma.

`markManual` fija explícitamente el estado `manual` para las plataformas
manuales (Req 6.3), invocado al crear o desde el detalle.

## Componentes React (español)

Todos los componentes consumen el catálogo `es` (extendido) y muestran texto en
español. Siguen el mismo estilo que `PaginaClientes`/`FormularioCliente`.

### PaginaPublicaciones (listado)

- Consume `getVideoPosts` con `useQuery`.
- Muestra las publicaciones del Usuario ordenadas por `createdAt` descendente
  (Req 4.1), con enlace al detalle y botón "Nueva publicación".
- Estados de carga/vacío/error en español.

### FormularioPublicacion (creación)

- Campos: URL del vídeo (obligatorio), referencia de archivo (opcional), brief y
  selección múltiple de plataformas (casillas).
- Validación en cliente que replica la del servidor: URL no vacía (Req 2.3) y al
  menos una plataforma seleccionada (Req 2.4), con mensajes en español.
- Al enviar invoca `createVideoPost`; al éxito navega al detalle.

### DetallePublicacion (variantes por plataforma)

- Consume `getVideoPost` (verifica propiedad, Req 4.2).
- Muestra la Fuente_Video, el brief y una tarjeta por `PlatformContent` con su
  `Estado_Publicacion` traducido al español (Req 9.2).
- Por cada plataforma:
  - **Generar/Regenerar** → `generatePlatformContent` (Req 3.1, 3.4).
  - **Automatizada** → botón **Publicar** → `publishPlatformContent` (Req 5.x).
  - **Manual** (Fiverr) → botón **Copiar** que copia título + descripción +
    hashtags al portapapeles (Req 6.1, 6.2); estado `manual`.
- Los errores del backend se muestran en español (Req 7.2).

### Extensión del catálogo i18n (`src/client/i18n/es.ts`)

Se **añade** una sección `publisher` (aditiva, sin tocar las claves existentes):

```typescript
publisher: {
  pageTitle: 'Publicaciones',
  newPost: 'Nueva publicación',
  empty: 'Aún no hay publicaciones. Crea la primera.',
  loading: 'Cargando publicaciones…',
  fields: {
    videoUrl: 'URL del vídeo',
    fileRef: 'Referencia de archivo',
    brief: 'Resumen del tema',
    platforms: 'Plataformas',
  },
  actions: {
    create: 'Crear publicación',
    generate: 'Generar',
    regenerate: 'Regenerar',
    publish: 'Publicar',
    copy: 'Copiar texto',
    copied: 'Texto copiado',
  },
  status: {
    pendiente: 'Pendiente',
    enviado: 'Enviado',
    error: 'Error',
    manual: 'Manual',
  },
  errors: {
    videoUrlRequired: 'La URL del vídeo es obligatoria',
    platformRequired: 'Selecciona al menos una plataforma',
  },
}
```

> Las claves de error de configuración (`errors.config`), no autorizado
> (`errors.unauthorized`) y recurso ajeno (`errors.resourceUnavailable`) del CRM
> se **reutilizan** tal cual.

## Tabla de manejo de errores (español)

| Condición | Origen | Respuesta | Requisito |
|---|---|---|---|
| Solicitud sin sesión | `requireUser` | HttpError 401 "No autorizado" | 1.2 |
| Operación sobre publicación ajena/inexistente | `requireOwnership` | HttpError 403 "Recurso no disponible" | 1.5 |
| URL de vídeo vacía al crear | `validatePublicacion` | HttpError 400 "La URL del vídeo es obligatoria" | 2.3, 7.1 |
| Sin plataformas seleccionadas | `validatePublicacion` | HttpError 400 "Selecciona al menos una plataforma" | 2.4, 7.1 |
| Falta `ANTHROPIC_API_KEY` al generar | `streamCompletion` (reuso) | HttpError 500 "Falta la configuración de la clave de API" + no invoca Claude | 3.5, 7.3 |
| Claude devuelve error en generación | `generatePlatformContent` | Propaga indicador de error; conserva contenido previo | 3.6 |
| Fallo de un destino de salida | `publicarEnDestinos` | Registra, marca `error`, continúa con los demás | 5.4 |
| Lista de destinos vacía (automatizada) | `publishPlatformContent` | Omite envío, marca `manual` | 5.5 |

## Configuración y variables de entorno

Se **reutilizan** las variables existentes; no se añaden nuevas.

| Variable | Uso | Lectura |
|---|---|---|
| `ANTHROPIC_API_KEY` | Credencial de Claude; guarda de configuración | `config.anthropicApiKey()` |
| `CLAUDE_MODEL` | Identificador del modelo (por defecto `claude-3-5-sonnet`) | `config.claudeModel()` |
| `OUTBOUND_WEBHOOK_URLS` | Destinos de publicación (Make/n8n/HTTP) | `config.outboundWebhookUrls()` vía `resolverDestinos()` |

El archivo `.env` permanece excluido del control de versiones (Req 8.5), como en
el CRM.

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe cumplirse en todas
las ejecuciones válidas del sistema — una afirmación formal sobre lo que el
sistema debe hacer. Las propiedades son el puente entre la especificación legible
por humanos y las garantías de correctitud verificables por máquina.*

### Property 1: Aislamiento por propietario en el listado

*Para cualquier* conjunto de Publicacion_Video pertenecientes a varios Usuarios,
`getVideoPosts` invocada por un Usuario devuelve exclusivamente las
Publicacion_Video cuyo `ownerId` coincide con el identificador de ese Usuario, y
cada Publicacion_Video creada queda asociada al identificador del Usuario que la
crea.

**Validates: Requirements 1.3, 1.4**

### Property 2: Control de acceso del backend

*Para cualquier* operación del Backend_Publicador, una invocación sin sesión de
Usuario produce un error de autorización, y una invocación de un Usuario sobre
una Publicacion_Video que no le pertenece produce un error de autorización sin
modificar ni revelar dicha Publicacion_Video.

**Validates: Requirements 1.2, 1.5**

### Property 3: Validación de creación

*Para cualquier* entrada de creación cuya URL de Fuente_Video sea vacía o
compuesta solo por espacios, o cuya selección de plataformas esté vacía,
`createVideoPost` rechaza la operación con un error de validación en español y no
persiste ninguna Publicacion_Video.

**Validates: Requirements 2.3, 2.4, 7.1**

### Property 4: Inicialización de contenidos por plataforma

*Para cualquier* entrada de creación válida con un conjunto de plataformas
seleccionadas, `createVideoPost` persiste exactamente un Contenido_Plataforma por
cada plataforma seleccionada, conserva la `fileRef` cuando se proporciona, y cada
Contenido_Plataforma de una Plataforma_Automatizada queda con Estado_Publicacion
`pendiente`.

**Validates: Requirements 2.1, 2.2, 2.5**

### Property 5: Generación produce y persiste contenido completo

*Para cualquier* Publicacion_Video propia y plataforma seleccionada, con el
Proveedor_Claude disponible, `generatePlatformContent` produce y persiste un
Contenido_Plataforma con los campos `title`, `description` y `hashtags`
presentes.

**Validates: Requirements 3.1, 3.3**

### Property 6: Adaptación del prompt por plataforma

*Para cualquier* plataforma del conjunto admitido, el prompt construido para esa
plataforma contiene la guía de tono y de límites definida para ella en el mapa de
plataformas.

**Validates: Requirements 3.2**

### Property 7: La regeneración reemplaza el contenido previo

*Para cualquier* Contenido_Plataforma ya generado, regenerar con una nueva salida
del Proveedor_Claude reemplaza por completo `title`, `description` y `hashtags`
con el nuevo resultado, manteniendo un único Contenido_Plataforma por plataforma.

**Validates: Requirements 3.4**

### Property 8: Guarda de clave de API

*Para cualquier* solicitud de generación realizada cuando la Clave_API está
ausente, el Backend_Publicador devuelve un error de configuración en español y no
invoca al Proveedor_Claude.

**Validates: Requirements 3.5, 7.3**

### Property 9: Conservación del contenido ante error del proveedor

*Para cualquier* Contenido_Plataforma con un contenido previo, si el
Proveedor_Claude devuelve un error durante la regeneración, el Backend_Publicador
propaga un indicador de error y conserva sin cambios el contenido previo de esa
plataforma.

**Validates: Requirements 3.6**

### Property 10: Orden del listado por fecha descendente

*Para cualquier* conjunto de Publicacion_Video propias del Usuario, `getVideoPosts`
las devuelve ordenadas de forma no creciente por `createdAt`.

**Validates: Requirements 4.1**

### Property 11: Fan-out de publicación, transiciones de estado y resiliencia

*Para cualquier* Contenido_Plataforma de una Plataforma_Automatizada y cualquier
Lista_Destinos_Salida no vacía, `publishPlatformContent` envía una solicitud HTTP
POST con la Carga_Publicacion a cada destino de la lista; cuando todos los envíos
tienen éxito el Estado_Publicacion resultante es `enviado`, y cuando al menos un
destino falla todos los demás destinos reciben igualmente su solicitud y el
Estado_Publicacion resultante es `error`.

**Validates: Requirements 5.1, 5.3, 5.4**

### Property 12: Deduplicación de destinos de salida

*Para cualquier* cadena de configuración de `OUTBOUND_WEBHOOK_URLS` con URLs
separadas por comas o espacios y posibles duplicados, la Lista_Destinos_Salida
resuelta no contiene URLs duplicadas.

**Validates: Requirements 5.2, 8.4**

### Property 13: Destinos vacíos resultan en estado manual

*Para cualquier* Contenido_Plataforma de una Plataforma_Automatizada, si la
Lista_Destinos_Salida está vacía al solicitar la publicación, el Backend_Publicador
omite el envío y asigna el Estado_Publicacion `manual`.

**Validates: Requirements 5.5**

### Property 14: Las plataformas manuales quedan en estado manual

*Para cualquier* selección de plataformas que incluya una Plataforma_Manual, el
Contenido_Plataforma correspondiente a esa plataforma queda con Estado_Publicacion
`manual`.

**Validates: Requirements 6.3**

### Property 15: Etiqueta de estado en español

*Para cualquier* valor de Estado_Publicacion (`pendiente`, `enviado`, `error`,
`manual`), el catálogo de interfaz proporciona una etiqueta en español no vacía.

**Validates: Requirements 9.2**

## Estrategia de pruebas (dual)

El producto se prueba con **Vitest** y **fast-check** (ya presentes en el
repositorio, ver los `*.property.test.ts` existentes), combinando pruebas
basadas en propiedades y pruebas por ejemplo.

### Pruebas basadas en propiedades (fast-check, mínimo 100 iteraciones)

- Cada propiedad de la sección anterior se implementa como un test de propiedad
  con la etiqueta **Feature: publicador-videos-ia, Property N: {texto}**.
- **Claude se mockea**: el async generator `streamCompletion` se sustituye por un
  generador que emite una respuesta controlada (JSON), de modo que la generación
  es determinista y barata.
- **`fetch` se mockea**: para las propiedades de publicación (fan-out, resiliencia
  y destinos vacíos) se usa un mock de `fetch` que registra las llamadas y puede
  forzar fallos en un subconjunto de destinos.
- El contexto de Prisma se simula con los stubs existentes en `src/test/`
  (`fakeContext`, `mockContext`, `waspEntities`).

### Pruebas por ejemplo (unitarias / de componente)

- **UI**: presencia del control de copiar en plataformas manuales (Req 6.1),
  copia al portapapeles con `navigator.clipboard` mockeado (Req 6.2), visualización
  de mensajes de error en español (Req 7.2) y uso del catálogo `es` (Req 9.1).
- **Validación**: mensajes en español por campo para entradas inválidas (Req 7.1).
- **Configuración**: `config.claudeModel` por defecto y desde variable (Req 8.1,
  8.2), `config.anthropicApiKey` (Req 8.3).
- **Smoke**: `authRequired: true` en las páginas del publicador (Req 1.1), `.env`
  excluido de control de versiones (Req 8.5).

### Equilibrio

Las pruebas de propiedad cubren la lógica universal (aislamiento, validación,
generación, publicación y transiciones de estado); las pruebas por ejemplo cubren
interacciones de UI puntuales, edge cases y configuración. Se evita duplicar en
pruebas unitarias lo que ya garantizan las propiedades.
