# Guía de integración: conectar el CRM con Make y n8n

Esta guía explica cómo conectar este CRM (construido con Wasp) con plataformas de
automatización como **Make (antes Integromat)** y **n8n**, tanto para recibir
eventos del CRM (**salida**) como para crear clientes desde sistemas externos
(**entrada**). Está basada en el comportamiento realmente implementado en el
backend.

---

## 1. Introducción

El CRM ofrece dos mecanismos de integración complementarios:

### Salida (outbound) — el CRM avisa a tus sistemas

Cada vez que se **crea** o **actualiza** un Cliente, el CRM envía automáticamente
una petición `POST` con los datos de ese Cliente a **todos** los destinos
(webhooks) que tengas configurados. Esto se llama difusión *multi-destino*
(*fan-out*):

- Puedes configurar **una o varias** URLs de destino.
- El envío a cada destino es **independiente**: si uno falla (por ejemplo, una
  URL caída), se registra el error en el log y **no** se interrumpe el envío a
  los demás destinos **ni** la operación de creación/actualización del Cliente.
- Si no hay ningún destino configurado, simplemente no se envía nada (sin error).

Esto te permite enviar el mismo evento a Make, a n8n y/o a cualquier otro
endpoint HTTP propio, todos a la vez.

### Entrada (inbound) — tus sistemas crean clientes en el CRM

El CRM expone un endpoint REST protegido por token que permite que un sistema
externo (Make, n8n, Zapier, un script propio, etc.) **cree** un Cliente sin
necesidad de iniciar sesión en la interfaz del CRM.

---

## 2. Formato del payload de salida

Cuando el CRM notifica un evento, envía a **cada** destino configurado:

- Método: `POST`
- Cabecera: `Content-Type: application/json`
- Cuerpo (JSON):

```json
{
  "event": "created",
  "client": {
    "id": 42,
    "name": "Ana Pérez",
    "email": "ana.perez@ejemplo.com",
    "phone": "+34 600 123 456",
    "company": "Acme S.L.",
    "status": "lead",
    "notes": "Interesada en el plan anual."
  }
}
```

Detalles del payload:

- `event` es `"created"` cuando el Cliente se acaba de crear y `"updated"` cuando
  se actualiza un Cliente existente.
- `client` contiene **exactamente** estos campos: `id`, `name`, `email`, `phone`,
  `company`, `status`, `notes`. (No se incluyen otros campos internos.)
- Los campos opcionales que estén vacíos pueden llegar como `null`.

---

## 3. Configurar `OUTBOUND_WEBHOOK_URLS` en `.env.server`

Los destinos de salida se definen en el archivo `.env.server` del backend
mediante la variable `OUTBOUND_WEBHOOK_URLS`.

- Acepta **una o varias** URLs separadas por **comas y/o espacios**.
- Se combina con la variable heredada `ZAPIER_WEBHOOK_URL` (si está definida) y
  los duplicados se eliminan automáticamente.

Ejemplo con un solo destino:

```bash
# .env.server
OUTBOUND_WEBHOOK_URLS=https://hook.eu2.make.com/abc123def456
```

Ejemplo con varios destinos (Make + n8n + endpoint propio):

```bash
# .env.server
OUTBOUND_WEBHOOK_URLS=https://hook.eu2.make.com/abc123def456,https://n8n.midominio.com/webhook/clientes-crm,https://mi-api.midominio.com/hooks/crm
```

> Después de modificar `.env.server`, **reinicia el servidor** para que los
> nuevos destinos surtan efecto (las variables se leen del entorno).

La variable heredada `ZAPIER_WEBHOOK_URL` sigue funcionando como destino único
adicional, por compatibilidad hacia atrás:

```bash
# .env.server
ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/123456/abcdef
```

---

## 4. Make (Integromat)

### 4.1. Salida: recibir eventos del CRM en Make

1. En Make, crea un **nuevo escenario**.
2. Añade como primer módulo **Webhooks > Custom webhook**.
3. Pulsa **Add** para crear un nuevo webhook, dale un nombre (por ejemplo,
   `CRM Clientes`) y guarda.
4. Make te mostrará una **URL** del tipo
   `https://hook.eu2.make.com/xxxxxxxxxxxxxxxx`. **Cópiala**.
5. Pega esa URL en `OUTBOUND_WEBHOOK_URLS` dentro de `.env.server` (ver
   sección 3) y reinicia el servidor.
6. En Make, deja el módulo escuchando ("Determine data structure" /
   *Re-determine data structure*) y, desde el CRM, **crea o actualiza un
   cliente** para disparar un evento real. Make capturará la estructura del
   payload automáticamente.
7. A partir de ahí, en los módulos siguientes podrás **mapear** los campos:
   - `event` → tipo de evento (`created` / `updated`).
   - `client.id`, `client.name`, `client.email`, `client.phone`,
     `client.company`, `client.status`, `client.notes`.

   Por ejemplo, puedes añadir un módulo de Gmail/Slack/Google Sheets y arrastrar
   `client.name` y `client.email` a los campos correspondientes.

### 4.2. Entrada: crear clientes en el CRM desde Make

Usa el módulo **HTTP > Make a request** con esta configuración:

- **URL**: `https://TU-DOMINIO/api/integrations/zapier/clients`
- **Method**: `POST`
- **Headers**:
  - `X-Zapier-Token`: `EL_VALOR_DE_ZAPIER_INBOUND_TOKEN`
  - `Content-Type`: `application/json`
- **Body type**: `Raw` / `JSON (application/json)`
- **Request content**:

```json
{
  "name": "Ana Pérez",
  "email": "ana.perez@ejemplo.com",
  "phone": "+34 600 123 456",
  "company": "Acme S.L.",
  "status": "lead",
  "notes": "Creado desde Make"
}
```

Respuestas esperadas:

- `201` → Cliente creado correctamente (el cuerpo devuelve el cliente serializado).
- `401` → token ausente o no válido.
- `400` → falta `name` o `email`.

---

## 5. n8n

### 5.1. Salida: recibir eventos del CRM en n8n

1. En n8n, crea un nuevo workflow y añade un nodo **Webhook**.
2. Configura el **HTTP Method** como `POST`.
3. Copia la **Production URL** que muestra el nodo (por ejemplo,
   `https://n8n.midominio.com/webhook/clientes-crm`).
4. Pega esa URL en `OUTBOUND_WEBHOOK_URLS` dentro de `.env.server` (ver
   sección 3) y reinicia el servidor.
5. Activa el workflow. Desde el CRM, **crea o actualiza un cliente** para que
   llegue un evento.
6. En los nodos siguientes puedes acceder a los datos con expresiones:
   - Tipo de evento: `{{$json.event}}`
   - Correo del cliente: `{{$json.client.email}}`
   - Nombre del cliente: `{{$json.client.name}}`
   - Estado del cliente: `{{$json.client.status}}`

   > Nota: según la versión de n8n y la opción "Webhook node response", los
   > datos del cuerpo pueden estar bajo `{{$json.body.event}}` y
   > `{{$json.body.client.email}}`. Verifica con la pestaña de datos del nodo
   > Webhook tras la primera ejecución.

### 5.2. Entrada: crear clientes en el CRM desde n8n

Usa un nodo **HTTP Request** con esta configuración:

- **Method**: `POST`
- **URL**: `https://TU-DOMINIO/api/integrations/zapier/clients`
- **Headers**:
  - `X-Zapier-Token`: `EL_VALOR_DE_ZAPIER_INBOUND_TOKEN`
- **Body Content Type**: `JSON`
- **Body**:

```json
{
  "name": "Carlos Gómez",
  "email": "carlos.gomez@ejemplo.com",
  "company": "Globex",
  "status": "lead",
  "notes": "Creado desde n8n"
}
```

Las respuestas (`201`, `401`, `400`) son las mismas descritas en la sección 6.

---

## Flujo completo en n8n (de extremo a extremo)

Esta sección describe cómo una **publicación** del módulo Publicador termina de
forma completa en n8n: desde que el usuario pulsa "Publicar" en una plataforma
hasta que la red social recibe el contenido y la app marca el estado como
**"enviado"**.

> Importante: el contenido de **Fiverr** es **manual** y **no** se envía por
> webhook. Solo se difunden las plataformas `linkedin`, `instagram`, `youtube`,
> `x` y `tiktok`.

### Qué envía la app (payload de publicación)

Cuando el usuario publica el contenido de una plataforma, la app hace un `POST`
con `Content-Type: application/json` a **cada** destino configurado en
`OUTBOUND_WEBHOOK_URLS` (ver sección 3) con este cuerpo:

```json
{
  "platform": "linkedin",
  "videoUrl": "https://.../mi-video.mp4",
  "content": {
    "title": "Título del post",
    "description": "Descripción larga del post...",
    "hashtags": "#marca #lanzamiento"
  }
}
```

`platform` toma uno de estos valores: `linkedin`, `instagram`, `youtube`, `x` o
`tiktok`.

### Paso a paso del flujo

1. **App → POST al Webhook de n8n.** Al publicar, la app difunde el payload
   anterior a la URL del nodo **Webhook** de n8n (la que copiaste en
   `OUTBOUND_WEBHOOK_URLS`).
2. **Nodo Webhook recibe.** El nodo Webhook (método `POST`, `responseMode:
   responseNode`) recibe la petición y expone los datos del cuerpo. Según la
   versión de n8n, el cuerpo está bajo `{{$json.body.*}}` (lo más habitual con
   un POST JSON) o directamente bajo `{{$json.*}}`. Verifícalo en la pestaña de
   datos del nodo tras la primera ejecución.
3. **Nodo Switch enruta por plataforma.** Un nodo **Switch** evalúa
   `={{ $json.body.platform }}` (o `={{ $json.platform }}` según tu versión) y
   dirige la ejecución a **una rama por plataforma**: `linkedin`, `youtube`,
   `instagram`, `x` y `tiktok`.
4. **Rama de publicación (último tramo).** Cada rama termina en un nodo de
   publicación que es responsabilidad del usuario configurar:
   - un **conector nativo de n8n** para esa red (por ejemplo, el nodo de
     LinkedIn o el de YouTube), **o**
   - un nodo **HTTP Request** que llame directamente a la **API** de la red
     social.

   En ese nodo mapeas los campos del payload:
   - Título: `{{$json.body.content.title}}`
   - Descripción: `{{$json.body.content.description}}`
   - Hashtags: `{{$json.body.content.hashtags}}`
   - URL del vídeo: `{{$json.body.videoUrl}}`
5. **Respond to Webhook.** Un nodo **Respond to Webhook** devuelve `200` para
   cerrar la petición HTTP de forma ordenada.
6. **La app marca "enviado".** Al recibir una respuesta satisfactoria, la app
   considera el envío completado y marca el estado de la publicación como
   **"enviado"**. (Si la respuesta no es satisfactoria o la URL está caída, ese
   destino cuenta como fallido, sin bloquear los demás.)

### Expectativas realistas

- **Cada red necesita credenciales/OAuth** configuradas dentro de n8n. El nodo
  nativo o el HTTP Request no publicará nada hasta que conectes la cuenta
  correspondiente (token/OAuth de LinkedIn, YouTube, X, etc.).
- **LinkedIn y YouTube** disponen de nodos nativos en n8n y/o API pública; otras
  redes pueden requerir nodos de comunidad o llamadas HTTP directas.
- **Algunas redes exigen subir el vídeo primero** (un paso de *upload* que
  devuelve un identificador o URL) y **después** crear la publicación que lo
  referencia. En esos casos, añade un nodo previo de subida en la rama y usa su
  salida en el nodo de publicación.
- Los **nodos de publicación son el "último tramo"**: la plantilla de abajo deja
  ese punto como un **placeholder** que cada usuario debe sustituir por el nodo
  nativo o la llamada real a la API de su cuenta.

### Plantilla completa importable: recibir, enrutar y publicar

Copia el siguiente JSON e impórtalo en n8n con **Import from clipboard / Import
from file**. Crea un workflow que **recibe** el webhook, **enruta** por
plataforma con un Switch y, en cada rama, publica en la red correspondiente.
Esta versión usa los **nodos nativos** de n8n donde existen
(**LinkedIn**, **YouTube** y **X/Twitter**) ya configurados con los campos
mapeados, y mantiene nodos **HTTP Request** para **Instagram** (Graph API) y
**TikTok** (Content Posting API) con URLs de ejemplo claramente marcadas que
debes reemplazar. Finaliza con **Respond to Webhook** devolviendo `200`.

> Tras importar, abre el nodo **Webhook**, copia su **Production URL** y pégala
> en `OUTBOUND_WEBHOOK_URLS` (sección 3). En los nodos nativos
> (**LinkedIn**, **YouTube**, **X/Twitter**) debes **adjuntar tus credenciales**
> (OAuth2) desde el desplegable de credenciales del nodo, porque la plantilla no
> las incluye. En los nodos **HTTP Request** de Instagram y TikTok, reemplaza las
> URLs de ejemplo (`https://EJEMPLO-REEMPLAZAR...`) por los endpoints reales de
> cada API y añade su autenticación. Consulta la sección
> [Configuración real por red (n8n)](#configuración-real-por-red-n8n) para el
> detalle de cada red.

```json
{
  "name": "Publicador - Recibir, enrutar y publicar",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "publicador",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "b1c2d3e4-0001-4000-8000-000000000001",
      "name": "Webhook Publicacion",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        240,
        400
      ],
      "webhookId": "publicador"
    },
    {
      "parameters": {
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "typeValidation": "loose"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.platform }}",
                    "rightValue": "linkedin",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "linkedin"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "typeValidation": "loose"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.platform }}",
                    "rightValue": "youtube",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "youtube"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "typeValidation": "loose"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.platform }}",
                    "rightValue": "instagram",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "instagram"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "typeValidation": "loose"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.platform }}",
                    "rightValue": "x",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "x"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "typeValidation": "loose"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.platform }}",
                    "rightValue": "tiktok",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "tiktok"
            }
          ]
        },
        "options": {}
      },
      "id": "b1c2d3e4-0002-4000-8000-000000000002",
      "name": "Switch Plataforma",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [
        520,
        400
      ]
    },
    {
      "parameters": {
        "postAs": "person",
        "text": "={{ $json.body.content.title }} {{ $json.body.content.description }} {{ $json.body.content.hashtags }}",
        "shareMediaCategory": "NONE",
        "additionalFields": {}
      },
      "id": "b1c2d3e4-0003-4000-8000-000000000003",
      "name": "Publicar en LinkedIn",
      "type": "n8n-nodes-base.linkedIn",
      "typeVersion": 1,
      "position": [
        820,
        80
      ],
      "notes": "Adjunta una credencial LinkedIn OAuth2. Para publicar VIDEO, usa la LinkedIn Posts API mediante un nodo HTTP Request (ver seccion 'Configuracion real por red')."
    },
    {
      "parameters": {
        "resource": "video",
        "operation": "upload",
        "title": "={{ $json.body.content.title }}",
        "regionCode": "ES",
        "categoryId": "22",
        "options": {
          "description": "={{ $json.body.content.description }} {{ $json.body.content.hashtags }}"
        }
      },
      "id": "b1c2d3e4-0004-4000-8000-000000000004",
      "name": "Publicar en YouTube",
      "type": "n8n-nodes-base.youTube",
      "typeVersion": 1,
      "position": [
        820,
        240
      ],
      "notes": "Adjunta una credencial Google OAuth2 (YouTube Data API v3). YouTube necesita el ARCHIVO de video (binario): antepon un nodo HTTP Request que descargue {{$json.body.videoUrl}} y pasa su binario al nodo YouTube."
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://graph.facebook.com/v19.0/EJEMPLO-REEMPLAZAR-IG_USER_ID/media",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ media_type: 'REELS', video_url: $json.body.videoUrl, caption: $json.body.content.title + ' ' + $json.body.content.description + ' ' + $json.body.content.hashtags }) }}",
        "options": {}
      },
      "id": "b1c2d3e4-0005-4000-8000-000000000005",
      "name": "Publicar en Instagram (HTTP - reemplazar)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        820,
        400
      ],
      "notes": "Instagram Graph API: este nodo crea el contenedor de media. Reemplaza IG_USER_ID y anade el token. Necesitas un SEGUNDO nodo (POST /{IG_USER_ID}/media_publish con creation_id) para publicar. Ver seccion 'Configuracion real por red'."
    },
    {
      "parameters": {
        "resource": "tweet",
        "operation": "create",
        "text": "={{ ($json.body.content.title + ' ' + $json.body.content.description + ' ' + $json.body.content.hashtags).slice(0, 280) }}",
        "additionalFields": {}
      },
      "id": "b1c2d3e4-0006-4000-8000-000000000006",
      "name": "Publicar en X",
      "type": "n8n-nodes-base.twitter",
      "typeVersion": 2,
      "position": [
        820,
        560
      ],
      "notes": "Adjunta una credencial X/Twitter OAuth2. El texto se recorta a ~280 caracteres. Para adjuntar VIDEO necesitas subir el media con la X API v2 (pasos extra)."
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://open.tiktokapis.com/v2/post/publish/video/init/",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ post_info: { title: $json.body.content.title + ' ' + $json.body.content.description + ' ' + $json.body.content.hashtags }, source_info: { source: 'PULL_FROM_URL', video_url: $json.body.videoUrl } }) }}",
        "options": {}
      },
      "id": "b1c2d3e4-0007-4000-8000-000000000007",
      "name": "Publicar en TikTok (HTTP - reemplazar)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        820,
        720
      ],
      "notes": "TikTok Content Posting API: requiere app en TikTok for Developers + OAuth (token Bearer). Verifica el dominio de video_url (domain verification) o sube el archivo en lugar de PULL_FROM_URL. Ver seccion 'Configuracion real por red'."
    },
    {
      "parameters": {
        "respondWith": "text",
        "responseCode": 200,
        "responseBody": "OK",
        "options": {}
      },
      "id": "b1c2d3e4-0008-4000-8000-000000000008",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [
        1120,
        400
      ]
    }
  ],
  "connections": {
    "Webhook Publicacion": {
      "main": [
        [
          {
            "node": "Switch Plataforma",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Switch Plataforma": {
      "main": [
        [
          {
            "node": "Publicar en LinkedIn",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Publicar en YouTube",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Publicar en Instagram (HTTP - reemplazar)",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Publicar en X",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Publicar en TikTok (HTTP - reemplazar)",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Publicar en LinkedIn": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Publicar en YouTube": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Publicar en Instagram (HTTP - reemplazar)": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Publicar en X": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Publicar en TikTok (HTTP - reemplazar)": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {},
  "pinData": {}
}
```

> Al importar, si tu instancia usa versiones distintas de los nodos (Webhook,
> Switch, HTTP Request o los nativos de LinkedIn/YouTube/X), n8n puede pedirte
> **actualizar el nodo** y **adjuntar credenciales**: acepta, conecta tus
> credenciales OAuth2 en cada nodo nativo y revisa que el Switch siga enrutando
> por `={{ $json.body.platform }}` y que el nodo Webhook conserve
> `responseMode: responseNode` para que funcione el "Respond to Webhook". Los
> parámetros exactos y `typeVersion` de cada nodo **varían según la versión de
> n8n**, por lo que algunos campos pueden mostrarse con otro nombre tras la
> actualización.

---

## Configuración real por red (n8n)

Esta sección detalla, **para cada una de las 5 plataformas automatizadas**, cómo
configurar de verdad el nodo de publicación en n8n: qué nodo usar, cómo conectar
la cuenta, qué campos del webhook mapear y qué limitaciones tener en cuenta.

Recuerda los campos disponibles en el payload (sección "Qué envía la app"):

- Título: `{{$json.body.content.title}}`
- Descripción: `{{$json.body.content.description}}`
- Hashtags: `{{$json.body.content.hashtags}}`
- URL del vídeo: `{{$json.body.videoUrl}}`

> Según tu versión de n8n y la opción de respuesta del Webhook, el cuerpo puede
> estar bajo `{{$json.body.*}}` o directamente bajo `{{$json.*}}`. Verifícalo en
> la pestaña de datos del nodo Webhook tras la primera ejecución y ajusta las
> expresiones.

### LinkedIn

- **(a) Nodo:** nodo **nativo** `n8n-nodes-base.linkedIn` ("LinkedIn"). Para
  publicar **vídeo** el nodo nativo se queda corto (soporta sobre todo texto y
  artículos), así que para vídeo se documenta más abajo una alternativa con
  **HTTP Request** a la LinkedIn Posts API.
- **(b) Conectar la cuenta:** crea una credencial **LinkedIn OAuth2** en n8n.
  1. Entra en el **LinkedIn Developer Portal** y crea una **app** asociada a una
     página de empresa.
  2. Solicita los productos/permisos de publicación (p. ej. *Share on LinkedIn*
     / *Sign In with LinkedIn*; para organizaciones, *Community Management* /
     *Marketing*).
  3. Copia el **Client ID** y **Client Secret** en la credencial de n8n y añade
     la **Redirect URL** que te indica n8n a la app de LinkedIn.
  4. Pulsa **Connect** en n8n para completar el flujo OAuth2.
- **(c) Mapeo de campos (post de texto):**
  - `text` →
    `={{ $json.body.content.title }} {{ $json.body.content.description }} {{ $json.body.content.hashtags }}`
  - `postAs`: `person` (perfil) u `organization` (página de empresa).
  - `shareMediaCategory`: `NONE` para texto.
- **(d) Caveats:** el nodo nativo publica bien texto/enlaces, pero la subida de
  **vídeo nativo** no está garantizada. Para vídeo usa un **HTTP Request** a la
  **Posts API** (`POST https://api.linkedin.com/rest/posts`), lo que normalmente
  requiere: (1) registrar la subida (*initializeUpload*), (2) subir el binario
  del vídeo (descárgalo antes con un nodo HTTP Request desde
  `{{$json.body.videoUrl}}`), y (3) crear el post referenciando el `video`
  obtenido. Añade la cabecera `LinkedIn-Version` y el `Authorization: Bearer`.

### YouTube

- **(a) Nodo:** nodo **nativo** `n8n-nodes-base.youTube` ("YouTube"), recurso
  **Video**, operación **Upload**.
- **(b) Conectar la cuenta:** credencial **Google OAuth2** en n8n.
  1. Crea un **proyecto en Google Cloud** y habilita la **YouTube Data API v3**.
  2. Configura la **pantalla de consentimiento OAuth** y crea credenciales de
     tipo **OAuth client ID** (aplicación web).
  3. Añade la **Redirect URL** de n8n a la lista de URIs autorizadas.
  4. Copia **Client ID** y **Client Secret** en la credencial de n8n y pulsa
     **Connect** para autorizar el canal.
- **(c) Mapeo de campos:**
  - `title` → `={{ $json.body.content.title }}`
  - `description` (en *Options*) →
    `={{ $json.body.content.description }} {{ $json.body.content.hashtags }}`
  - El **archivo de vídeo** se pasa como **binario**, no como URL.
- **(d) Caveats:** YouTube necesita el **fichero real** del vídeo, no una URL.
  Antepón un nodo **HTTP Request** (método `GET`, *Response Format: File*) que
  descargue `{{$json.body.videoUrl}}` y entrega su **binario** al nodo YouTube
  (campo *Binary Property*). Ten en cuenta cuotas de la API y que las subidas
  pueden tardar.

### Instagram

- **(a) Nodo:** **no** hay nodo de publicación nativo de primera clase; se usa
  un nodo **HTTP Request** contra la **Instagram Graph API** (parte de la
  **Facebook Graph API**).
- **(b) Conectar la cuenta:** necesitas una **cuenta de Instagram Business**
  vinculada a una **Página de Facebook**, una **app de Meta** (Meta for
  Developers) con los permisos `instagram_basic`,
  `instagram_content_publish` y `pages_read_engagement`, y un **token de acceso
  de larga duración**. En n8n guarda ese token como credencial **Header Auth**
  (`Authorization: Bearer <token>`) o pásalo como parámetro `access_token`.
- **(c) Mapeo de campos (flujo de 2 pasos):**
  1. **Crear contenedor de media:**
     `POST https://graph.facebook.com/v19.0/{IG_USER_ID}/media`
     con `media_type=REELS`, `video_url={{$json.body.videoUrl}}` y
     `caption={{$json.body.content.title}} {{$json.body.content.description}} {{$json.body.content.hashtags}}`.
     Devuelve un `id` (el `creation_id`).
  2. **Publicar el contenedor:**
     `POST https://graph.facebook.com/v19.0/{IG_USER_ID}/media_publish`
     con `creation_id={{ $json.id }}` (el id del paso anterior).
- **(d) Caveats:** la creación del Reel es **asíncrona**; conviene consultar el
  campo `status_code` del contenedor hasta que sea `FINISHED` antes de publicar.
  Sustituye `{IG_USER_ID}` por el ID de tu cuenta de Instagram Business. El vídeo
  debe estar accesible públicamente en `video_url`.

### X / Twitter

- **(a) Nodo:** nodo **nativo** `n8n-nodes-base.twitter` ("X (Formerly
  Twitter)"), recurso **Tweet**, operación **Create**.
- **(b) Conectar la cuenta:** credencial **Twitter/X OAuth2** en n8n.
  1. Crea un **Project + App** en el **X Developer Portal** con acceso a la
     **API v2**.
  2. Habilita **OAuth 2.0**, configura permisos de **lectura y escritura** y la
     **Callback URL** de n8n.
  3. Copia **Client ID** y **Client Secret** en la credencial de n8n y pulsa
     **Connect**.
- **(c) Mapeo de campos:**
  - `text` →
    `={{ ($json.body.content.title + ' ' + $json.body.content.description + ' ' + $json.body.content.hashtags).slice(0, 280) }}`
    (respeta el límite de ~280 caracteres).
- **(d) Caveats:** publicar **vídeo** requiere subir el media primero
  (endpoint de *media upload* de la X API) y adjuntar el `media_id` al tweet, lo
  que puede necesitar pasos extra y un nivel de acceso de API adecuado. El plan
  gratuito de la API de X tiene límites estrictos de publicación.

### TikTok

- **(a) Nodo:** **no** existe nodo nativo; usa un nodo **HTTP Request** contra
  la **TikTok Content Posting API**.
- **(b) Conectar la cuenta:** crea una **app en TikTok for Developers**, solicita
  el scope `video.publish` (Content Posting API) y completa el flujo **OAuth**
  para obtener un **access token**. En n8n guárdalo como credencial
  **Header Auth** (`Authorization: Bearer <token>`).
- **(c) Mapeo de campos (flujo de subida/publicación):**
  1. **Iniciar la publicación:**
     `POST https://open.tiktokapis.com/v2/post/publish/video/init/`
     con `post_info.title` =
     `{{$json.body.content.title}} {{$json.body.content.description}} {{$json.body.content.hashtags}}`
     y `source_info` con `source=PULL_FROM_URL` y
     `video_url={{$json.body.videoUrl}}` (o `FILE_UPLOAD` si subes el binario).
  2. Si usas `FILE_UPLOAD`, sube el binario a la `upload_url` devuelta y luego
     consulta el estado con
     `POST https://open.tiktokapis.com/v2/post/publish/status/fetch/`.
- **(d) Caveats:** para usar `PULL_FROM_URL` debes **verificar el dominio** de la
  URL del vídeo en el portal de desarrolladores. Las apps no auditadas publican
  en modo restringido (privado/solo para revisión). Respeta los formatos y
  límites de tamaño/duración de TikTok.

---

## Checklist de puesta en marcha

Antes de activar el workflow, prepara por cada red la cuenta de desarrollador / app
y la credencial correspondiente en n8n:

| Red | Cuenta / app de desarrollador necesaria | Credencial a crear en n8n |
|-----|------------------------------------------|---------------------------|
| **LinkedIn** | App en LinkedIn Developer Portal con permisos de publicación (Share/Marketing) | **LinkedIn OAuth2** (nodo nativo). Para vídeo: token + HTTP Request a la Posts API |
| **YouTube** | Proyecto en Google Cloud con **YouTube Data API v3** habilitada y OAuth client ID | **Google OAuth2** (nodo nativo YouTube) |
| **Instagram** | Cuenta **Instagram Business** + Página de Facebook, app de **Meta** con `instagram_content_publish`, token de larga duración | **Header Auth** con `Authorization: Bearer <token>` (HTTP Request, Graph API) |
| **X / Twitter** | Project + App en X Developer Portal (API v2, OAuth 2.0, lectura/escritura) | **Twitter/X OAuth2** (nodo nativo) |
| **TikTok** | App en **TikTok for Developers** con scope `video.publish` (Content Posting API) | **Header Auth** con `Authorization: Bearer <token>` (HTTP Request) |

> Recuerda: en todos los casos debes **adjuntar la credencial al nodo** dentro de
> n8n. La plantilla importable no incluye credenciales por seguridad, así que tras
> importar verás los nodos sin conectar hasta que selecciones (o crees) la
> credencial correspondiente.

---

## 6. Referencia del endpoint de entrada

- **Ruta**: `POST /api/integrations/zapier/clients`
- **Autenticación**: cabecera `X-Zapier-Token: <ZAPIER_INBOUND_TOKEN>`.
  Alternativamente, puedes enviar el token en el cuerpo como campo `token`.
- **Cuerpo (JSON)**:

  | Campo     | Obligatorio | Tipo     | Descripción                          |
  |-----------|-------------|----------|--------------------------------------|
  | `name`    | Sí          | string   | Nombre del cliente.                  |
  | `email`   | Sí          | string   | Correo electrónico del cliente.      |
  | `phone`   | No          | string   | Teléfono.                            |
  | `company` | No          | string   | Empresa.                             |
  | `status`  | No          | string   | Estado (si se omite, usa el valor por defecto del esquema). |
  | `notes`   | No          | string   | Notas.                               |
  | `ownerId` | No          | número   | Identificador del agente propietario.|

- **Respuestas**:
  - `201 Created` → devuelve el cliente serializado (`id`, `name`, `email`,
    `phone`, `company`, `status`, `notes`).
  - `401 Unauthorized` → token ausente o incorrecto.
  - `400 Bad Request` → falta `name` o `email`.

Ejemplo con `curl`:

```bash
curl -X POST https://TU-DOMINIO/api/integrations/zapier/clients \
  -H "Content-Type: application/json" \
  -H "X-Zapier-Token: EL_VALOR_DE_ZAPIER_INBOUND_TOKEN" \
  -d '{"name":"Ana Pérez","email":"ana.perez@ejemplo.com","company":"Acme S.L."}'
```

---

## 7. Plantilla de workflow de n8n (importable)

Copia el siguiente JSON y, en n8n, usa **Import from clipboard / Import from
file** para cargar un workflow mínimo con un nodo **Webhook** que recibe los
eventos de salida del CRM. Tras importar, abre el nodo Webhook, copia su
**Production URL** y pégala en `OUTBOUND_WEBHOOK_URLS`.

```json
{
  "name": "CRM Clientes - Entrada de eventos",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "clientes-crm",
        "responseMode": "onReceived",
        "options": {}
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000001",
      "name": "Webhook CRM",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [
        260,
        300
      ],
      "webhookId": "clientes-crm"
    }
  ],
  "connections": {},
  "active": false,
  "settings": {},
  "pinData": {}
}
```

> Si tu instancia de n8n usa una versión distinta del nodo Webhook, puede que al
> importar te pida actualizar el nodo; acepta y vuelve a copiar la Production URL.

> Esta plantilla mínima solo **recibe** el evento. Si quieres el flujo **completo
> de extremo a extremo** que además **enruta por plataforma y publica** (Webhook
> → Switch → nodo por red → Respond to Webhook), usa la plantilla de la sección
> [Flujo completo en n8n (de extremo a extremo)](#flujo-completo-en-n8n-de-extremo-a-extremo).

---

## 8. Seguridad

- **No expongas el token de entrada.** `ZAPIER_INBOUND_TOKEN` es un secreto:
  trátalo como una contraseña. No lo incluyas en repositorios, capturas de
  pantalla ni mensajes públicos.
- **Usa siempre HTTPS** tanto para los webhooks de salida como para el endpoint
  de entrada, de modo que el token y los datos viajen cifrados.
- **No versiones `.env.server`.** Este archivo contiene secretos y está excluido
  del control de versiones (ver `.gitignore`). Usa `.env.server.example` como
  plantilla sin valores reales.
- Genera un token **largo y aleatorio** para `ZAPIER_INBOUND_TOKEN` y rótalo si
  sospechas que se ha filtrado.
- Prefiere enviar el token por la cabecera `X-Zapier-Token` antes que en el
  cuerpo, para reducir el riesgo de que quede registrado en logs intermedios.

---

## 9. Resolución de problemas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| No llega ningún webhook de salida | `OUTBOUND_WEBHOOK_URLS` (y `ZAPIER_WEBHOOK_URL`) vacíos, o el servidor no se reinició tras editar `.env.server` | Configura al menos una URL y reinicia el servidor. Verifica que la URL sea de producción (no de prueba/edición). |
| Llega a un destino pero no a otro | Una de las URLs es incorrecta o el servicio está caído | Revisa los logs del servidor: cada fallo de destino se registra sin detener los demás. Corrige o reemplaza la URL afectada. |
| El destino recibe datos pero los campos están vacíos | Mapeo incorrecto en Make/n8n, o se capturó la estructura antes de enviar un evento real | Vuelve a determinar la estructura ("Re-determine data structure" en Make) tras crear/actualizar un cliente y remapea `event` y `client.*`. En n8n revisa si los datos están bajo `body`. |
| `401` al crear cliente (entrada) | Token ausente o distinto al configurado | Asegúrate de enviar la cabecera `X-Zapier-Token` con el valor exacto de `ZAPIER_INBOUND_TOKEN`. Revisa espacios o saltos de línea. |
| `400` al crear cliente (entrada) | Falta `name` o `email`, o están vacíos | Incluye ambos campos con valores no vacíos en el cuerpo JSON. |
| El cliente se crea pero no se dispara la salida | El evento de salida es independiente de la entrada vía endpoint; comprueba la configuración de salida | Verifica `OUTBOUND_WEBHOOK_URLS` y los logs. Recuerda que un fallo de notificación no revierte la creación del cliente. |
| Respuesta de red/timeout en Make o n8n | URL del CRM inaccesible o sin HTTPS válido | Comprueba el dominio, el certificado y que el endpoint sea accesible desde Internet. |
