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
