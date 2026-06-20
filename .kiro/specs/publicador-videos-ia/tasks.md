# Plan de Implementación: Publicador de Vídeos IA

## Visión general

Este plan implementa el "Publicador de Vídeos IA" de forma **aditiva** sobre la
aplicación Wasp existente (CRM) en `/projects/sandbox/kepasport.github.io/`. Cada
tarea construye sobre la anterior y termina cableando las piezas entre sí, sin
dejar código huérfano. Se **reutilizan** las piezas existentes:

- Autenticación / propiedad: `src/server/auth/ownership.ts` (`requireUser`, `requireOwnership`).
- Integración Claude: `src/server/chat/claudeProvider.ts` (`streamCompletion`) y `src/server/config.ts` (`anthropicApiKey`, `claudeModel`).
- Salida genérica: `src/server/integrations/outbound.ts` (`resolverDestinos`) y `config.outboundWebhookUrls()`.

Las pruebas (Vitest + fast-check) reutilizan los stubs de `src/test/`
(`fakeContext`, `mockContext`, `waspEntities`). Las sub-tareas marcadas con `*`
son opcionales (pruebas) y pueden omitirse para un MVP más rápido.

## Tareas

- [ ] 1. Declaraciones de plataforma y validación (sin tocar main.wasp)
  - [ ] 1.1 Crear el mapa de plataformas `src/server/publisher/platforms.ts`
    - Definir el tipo `Platform`, `PlatformKind`, la interfaz `PlatformGuide` y el mapa `platformGuides` con `label`, `kind`, `tone` y `limits` por plataforma (linkedin, instagram, youtube, x, tiktok, fiverr)
    - Exportar `PLATAFORMAS` y la función `esManual(p)`
    - _Requisitos: 3.2, 6.3_
  - [ ] 1.2 Crear la validación `src/server/publisher/validation.ts`
    - Implementar `validatePublicacion(input)` que rechace URL de vídeo vacía o solo espacios y rechace selección de plataformas vacía, lanzando `HttpError` con mensajes en español por campo
    - _Requisitos: 2.3, 2.4, 7.1_
  - [ ]* 1.3 Escribir prueba de propiedad para la adaptación del prompt y la validación
    - **Property 6: Adaptación del prompt por plataforma** — _Validates: Requirements 3.2_
    - **Property 3: Validación de creación** (a nivel de `validatePublicacion`) — _Validates: Requirements 2.3, 2.4, 7.1_
    - Usar fast-check (mínimo 100 iteraciones), etiqueta `Feature: publicador-videos-ia, Property N`

- [ ] 2. Capa de IA: generación de contenido por plataforma
  - [ ] 2.1 Crear `src/server/publisher/aiContent.ts`
    - Implementar `generateText(prompt)` que consume el async generator `streamCompletion` (REUSO) y ensambla el texto completo; la guarda de clave de API vive dentro de `streamCompletion` (HttpError 500 si falta `ANTHROPIC_API_KEY`)
    - Implementar `buildPrompt(brief, videoUrl, platform)` incluyendo tono y límites de `platformGuides`
    - Implementar `generateContentForPlatform(brief, videoUrl, platform)` que genera y parsea
    - Implementar `parseContenido(salida)` tolerante: intenta `JSON.parse` y, si falla, extrae por secciones; siempre devuelve `{ title, description, hashtags }` (cadenas vacías como respaldo)
    - _Requisitos: 3.1, 3.2, 3.3, 3.5, 7.3, 8.3_
  - [ ]* 2.2 Escribir prueba de propiedad para `parseContenido` (round-trip / forma estable)
    - **Property 5: Generación produce y persiste contenido completo** (nivel de parseo) — _Validates: Requirements 3.1, 3.3_
    - Mockear `streamCompletion` para emitir JSON controlado; verificar que siempre se devuelven los tres campos
  - [ ]* 2.3 Escribir prueba de propiedad para la guarda de clave de API
    - **Property 8: Guarda de clave de API** — _Validates: Requirements 3.5, 7.3_
    - Mockear ausencia de `ANTHROPIC_API_KEY`; verificar error de configuración en español y que no se invoca a Claude

- [ ] 3. Despachador de salida (publicación)
  - [ ] 3.1 Crear `src/server/publisher/dispatch.ts`
    - Definir `CargaPublicacion` y `ResultadoEnvio`
    - Implementar `publicarEnDestinos(carga)` que reutiliza `resolverDestinos()` (REUSO), hace `fetch` POST a cada destino con aislamiento de fallo por destino (try/catch por URL, continúa con los demás) y devuelve `{ total, fallidos }`
    - _Requisitos: 5.1, 5.2, 5.4_
  - [ ]* 3.2 Escribir prueba de propiedad para deduplicación de destinos
    - **Property 12: Deduplicación de destinos de salida** — _Validates: Requirements 5.2, 8.4_
  - [ ]* 3.3 Escribir prueba de propiedad para fan-out y resiliencia
    - **Property 11: Fan-out de publicación, transiciones de estado y resiliencia** (nivel de `publicarEnDestinos`) — _Validates: Requirements 5.1, 5.3, 5.4_
    - Mockear `fetch` registrando llamadas y forzando fallos en un subconjunto de destinos

- [ ] 4. Checkpoint — Asegurar que pasan todas las pruebas
  - Ejecutar la suite de pruebas; asegurarse de que todo pasa y preguntar al usuario si surgen dudas.

- [ ] 5. Consultas del backend
  - [ ] 5.1 Crear `src/server/publisher/queries.ts`
    - Implementar `getVideoPosts`: `requireUser` y devolver solo las `VideoPost` del propietario ordenadas por `createdAt` descendente
    - Implementar `getVideoPost`: `requireUser` + `requireOwnership`, incluyendo los `PlatformContent` asociados
    - _Requisitos: 1.4, 4.1, 4.2_
  - [ ]* 5.2 Escribir prueba de propiedad para aislamiento por propietario y orden
    - **Property 1: Aislamiento por propietario en el listado** — _Validates: Requirements 1.3, 1.4_
    - **Property 10: Orden del listado por fecha descendente** — _Validates: Requirements 4.1_
    - Usar stubs de `src/test/` (`fakeContext`, `waspEntities`)

- [ ] 6. Acciones del backend
  - [ ] 6.1 Implementar `createVideoPost` en `src/server/publisher/actions.ts`
    - `requireUser`, `validatePublicacion`, persistir `VideoPost` asociada al `ownerId`, conservar `fileRef` si se proporciona
    - Inicializar un `PlatformContent` por plataforma seleccionada con estado `pendiente`; marcar las plataformas manuales (Fiverr) con estado `manual`
    - _Requisitos: 1.3, 2.1, 2.2, 2.5, 6.3_
  - [ ]* 6.2 Escribir prueba de propiedad para inicialización de contenidos y plataformas manuales
    - **Property 4: Inicialización de contenidos por plataforma** — _Validates: Requirements 2.1, 2.2, 2.5_
    - **Property 14: Las plataformas manuales quedan en estado manual** — _Validates: Requirements 6.3_
    - **Property 3: Validación de creación** (nivel de acción, sin persistencia en caso inválido) — _Validates: Requirements 2.3, 2.4, 7.1_
  - [ ] 6.3 Implementar `generatePlatformContent` en `src/server/publisher/actions.ts`
    - `requireUser` + `requireOwnership`, llamar a `generateContentForPlatform`, persistir/reemplazar `title`/`description`/`hashtags` del `PlatformContent`
    - Ante error del proveedor: propagar indicador de error y conservar el contenido previo sin cambios
    - _Requisitos: 1.5, 3.1, 3.3, 3.4, 3.6_
  - [ ]* 6.4 Escribir prueba de propiedad para regeneración y conservación ante error
    - **Property 7: La regeneración reemplaza el contenido previo** — _Validates: Requirements 3.4_
    - **Property 9: Conservación del contenido ante error del proveedor** — _Validates: Requirements 3.6_
    - **Property 5: Generación produce y persiste contenido completo** (nivel de acción con Prisma simulado) — _Validates: Requirements 3.1, 3.3_
  - [ ] 6.5 Implementar `publishPlatformContent` y `markManual` en `src/server/publisher/actions.ts`
    - `publishPlatformContent`: `requireUser` + `requireOwnership`, construir `CargaPublicacion`, llamar a `publicarEnDestinos`; `total === 0` → `manual`, `fallidos === 0` → `enviado`, `fallidos > 0` → `error`; persistir el estado
    - `markManual`: `requireUser` + `requireOwnership`, fijar estado `manual`
    - _Requisitos: 1.5, 5.1, 5.3, 5.4, 5.5, 6.3, 4.3_
  - [ ]* 6.6 Escribir prueba de propiedad para transiciones de estado y control de acceso
    - **Property 11: Fan-out, transiciones de estado y resiliencia** (nivel de acción) — _Validates: Requirements 5.1, 5.3, 5.4_
    - **Property 13: Destinos vacíos resultan en estado manual** — _Validates: Requirements 5.5_
    - **Property 2: Control de acceso del backend** — _Validates: Requirements 1.2, 1.5_

- [ ] 7. Checkpoint — Asegurar que pasan todas las pruebas
  - Ejecutar la suite de pruebas; asegurarse de que todo pasa y preguntar al usuario si surgen dudas.

- [ ] 8. Cableado en Wasp (main.wasp) — adiciones
  - [ ] 8.1 Añadir entidades, relación y operaciones en `main.wasp`
    - Añadir la relación aditiva `videoPosts VideoPost[]` a la entidad `User` existente (sin tocar el resto)
    - Añadir entidades `VideoPost` y `PlatformContent` con sus campos, índices y `onDelete: Cascade`
    - Añadir consultas `getVideoPosts`/`getVideoPost` y acciones `createVideoPost`/`generatePlatformContent`/`publishPlatformContent`/`markManual` apuntando a `@src/server/publisher/...`
    - _Requisitos: 1.3, 2.1, 2.5, 4.1, 4.3_
  - [ ] 8.2 Añadir rutas y páginas protegidas en `main.wasp`
    - Añadir `PublicacionesRoute`, `NuevaPublicacionRoute` y `DetallePublicacionRoute` con sus páginas y `authRequired: true`
    - _Requisitos: 1.1_

- [ ] 9. Interfaz React (español)
  - [ ] 9.1 Extender el catálogo i18n `src/client/i18n/es.ts`
    - Añadir la sección `publisher` (aditiva, sin tocar claves existentes) con `pageTitle`, `newPost`, `empty`, `loading`, `fields`, `actions`, `status` y `errors`
    - _Requisitos: 9.1, 9.2_
  - [ ]* 9.2 Escribir prueba por ejemplo para etiquetas de estado en español
    - **Property 15: Etiqueta de estado en español** — _Validates: Requirements 9.2_
    - Verificar que cada `Estado_Publicacion` (`pendiente`, `enviado`, `error`, `manual`) tiene etiqueta no vacía en `es`
  - [ ] 9.3 Crear `src/client/publisher/PaginaPublicaciones.tsx` (listado)
    - Consumir `getVideoPosts` con `useQuery`; mostrar publicaciones ordenadas por fecha descendente, enlace al detalle y botón "Nueva publicación"; estados de carga/vacío/error en español
    - _Requisitos: 4.1, 9.1_
  - [ ] 9.4 Crear `src/client/publisher/FormularioPublicacion.tsx` (creación)
    - Campos: URL del vídeo (obligatorio), referencia de archivo (opcional), brief y selección múltiple de plataformas
    - Validación en cliente (URL no vacía, al menos una plataforma) con mensajes en español; al enviar invoca `createVideoPost` y navega al detalle
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 7.2, 9.1_
  - [ ] 9.5 Crear `src/client/publisher/DetallePublicacion.tsx` (variantes por plataforma)
    - Consumir `getVideoPost`; mostrar Fuente_Video, brief y una tarjeta por `PlatformContent` con estado traducido al español
    - Botones por plataforma: Generar/Regenerar (`generatePlatformContent`), Publicar para automatizadas (`publishPlatformContent`), Copiar para manuales (copia título + descripción + hashtags al portapapeles); mostrar errores del backend en español
    - _Requisitos: 4.2, 3.1, 3.4, 5.1, 6.1, 6.2, 7.2, 9.1, 9.2_
  - [ ]* 9.6 Escribir pruebas por ejemplo de UI
    - Presencia del control de copiar en plataformas manuales y copia al portapapeles con `navigator.clipboard` mockeado — _Requisitos: 6.1, 6.2_
    - Visualización de mensajes de error en español — _Requisitos: 7.2_

- [ ] 10. Integración y verificación final
  - [ ]* 10.1 Escribir prueba de integración del flujo crear → generar → publicar
    - Mockear `streamCompletion` y `fetch`; verificar el ciclo completo con `fakeContext`/`mockContext`
    - _Requisitos: 2.1, 3.1, 5.1, 5.3_
  - [ ] 10.2 Checkpoint final — Asegurar que pasan todas las pruebas
    - Ejecutar la suite completa; asegurarse de que todo pasa y preguntar al usuario si surgen dudas.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Cimientos sin dependencias entre sí ni con main.wasp (plataformas, validación, IA, despachador)",
      "tasks": ["1.1", "1.2", "2.1", "3.1"]
    },
    {
      "wave": 2,
      "description": "Pruebas de propiedad de la wave 1 (tras su implementación)",
      "tasks": ["1.3", "2.2", "2.3", "3.2", "3.3"]
    },
    {
      "wave": 3,
      "description": "Checkpoint de cimientos",
      "tasks": ["4"]
    },
    {
      "wave": 4,
      "description": "Consultas y acciones del backend (dependen de platforms/validation/aiContent/dispatch)",
      "tasks": ["5.1", "6.1", "6.3", "6.5"]
    },
    {
      "wave": 5,
      "description": "Pruebas de propiedad del backend (tras su implementación)",
      "tasks": ["5.2", "6.2", "6.4", "6.6"]
    },
    {
      "wave": 6,
      "description": "Checkpoint del backend",
      "tasks": ["7"]
    },
    {
      "wave": 7,
      "description": "Cableado en main.wasp: entidades, operaciones, rutas y páginas (depende de queries/actions y componentes referenciados)",
      "tasks": ["8.1", "8.2"]
    },
    {
      "wave": 8,
      "description": "Interfaz React e i18n (consumen las operaciones cableadas)",
      "tasks": ["9.1", "9.3", "9.4", "9.5"]
    },
    {
      "wave": 9,
      "description": "Pruebas de UI/ejemplo (tras los componentes)",
      "tasks": ["9.2", "9.6"]
    },
    {
      "wave": 10,
      "description": "Integración y checkpoint final",
      "tasks": ["10.1", "10.2"]
    }
  ]
}
```

## Notas

- Las sub-tareas marcadas con `*` son opcionales (pruebas) y pueden omitirse para un MVP más rápido; las tareas de nivel superior nunca se marcan como opcionales.
- Cada tarea referencia requisitos específicos para trazabilidad; las pruebas de propiedad referencian su número de propiedad del diseño.
- El plan es **aditivo**: no se modifica ni elimina ninguna declaración del CRM existente en `main.wasp`.
- Las waves separan deliberadamente las tareas que tocan `main.wasp` (wave 7) y agrupan las pruebas después de su implementación correspondiente.
- Cada propiedad (1–15) del diseño está cubierta por al menos una sub-tarea de prueba de propiedad.
