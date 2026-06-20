# Documento de Requisitos

## Introducción

Este producto es un CRM de clientes ("Client CRM") construido sobre Wasp (frontend React, backend Node.js mediante operaciones de Wasp y persistencia con Prisma), escrito en TypeScript. El producto permite a agentes autenticados gestionar clientes y contactos, registrar actividad por cliente, y trabajar con un asistente de IA basado en el modelo Claude de Anthropic que conversa, redacta mensajes y resume información de clientes. El producto se integra con automatizaciones externas mediante webhooks para notificar cambios de clientes a una lista configurable de destinos de salida (por ejemplo Zapier, Make, n8n o un endpoint HTTP propio) y para permitir la creación de clientes desde Zapier a través de un endpoint autenticado (entrada). El asistente transmite las respuestas token a token y persiste el historial de conversación por usuario. Toda la interfaz de cara al usuario y los mensajes de error se presentan en español. El modelo de Claude, la clave de API y los secretos de Zapier se configuran mediante variables de entorno almacenadas en `.env`, excluido del control de versiones.

## Glosario

- **Sistema_CRM**: La capacidad de extremo a extremo del producto CRM, incluyendo la interfaz React, las operaciones del backend de Wasp, la persistencia con Prisma y las integraciones con Claude y Zapier.
- **Interfaz_Web**: El conjunto de componentes del frontend React mediante los cuales un agente gestiona clientes, consulta actividad e interactúa con el asistente.
- **Backend_CRM**: Las operaciones y acciones de Wasp/Node.js que procesan solicitudes de gestión de clientes, actividad, asistente e integraciones.
- **Agente**: Un usuario del CRM que ha completado el flujo de inicio de sesión y posee una sesión válida.
- **Cliente**: Entidad Prisma que representa a un cliente o contacto, con los campos nombre, correo electrónico, teléfono, empresa, estado y notas.
- **Estado_Cliente**: El campo de etapa o estado del Cliente dentro del flujo comercial (por ejemplo, prospecto, activo, cerrado).
- **Registro_Actividad**: Entidad Prisma que representa una entrada cronológica de actividad o nota asociada a un Cliente.
- **Asistente_IA**: La capacidad conversacional basada en el modelo Claude, integrada en el producto, que conversa, redacta mensajes y resume información de clientes.
- **Interfaz_Chat**: El componente React mediante el cual un Agente lee y envía mensajes al Asistente_IA.
- **Proveedor_Claude**: La capa de integración que envía solicitudes a la API de Claude de Anthropic y recibe respuestas.
- **Conversacion**: Entidad Prisma persistida que agrupa una secuencia ordenada de mensajes pertenecientes a un único Agente.
- **Mensaje**: Entidad Prisma persistida que representa un turno de una Conversacion, con un rol (usuario o asistente) y contenido de texto.
- **Identificador_Modelo**: El nombre configurable del modelo de Claude (valor por defecto `claude-3-5-sonnet`) leído desde una variable de entorno.
- **Clave_API**: La credencial de la API de Anthropic almacenada en el archivo `.env` y excluida del control de versiones.
- **Webhook_Zapier_Salida**: La URL de webhook de Zapier configurada a la que el Sistema_CRM notifica cuando se crea o actualiza un Cliente, conservada por compatibilidad con configuraciones anteriores.
- **Destino_Salida**: Un sistema externo (por ejemplo Zapier, Make, n8n o un endpoint HTTP propio) identificado por una URL de webhook al que el Sistema_CRM envía notificaciones de cambios de Cliente.
- **Lista_Destinos_Salida**: El conjunto deduplicado de URLs de Destino_Salida, compuesto por las URLs de la variable de entorno `OUTBOUND_WEBHOOK_URLS` (separadas por comas o espacios en blanco) más la URL del Webhook_Zapier_Salida heredada.
- **Endpoint_Zapier_Entrada**: El endpoint de API autenticado mediante el cual Zapier crea registros de Cliente en el Sistema_CRM.
- **Token_Integracion**: La clave o token secreto que autentica las solicitudes entrantes al Endpoint_Zapier_Entrada, almacenado en `.env`.
- **Semilla_BD**: El proceso de inicialización de la base de datos que crea datos de demostración iniciales en el Sistema_CRM.
- **Cliente_Demo**: El registro de Cliente de demostración inicial con nombre "Kepa Bilbao" que la Semilla_BD crea y asocia a un Agente propietario.

## Requisitos

### Requisito 1: Acceso autenticado al producto

**Historia de usuario:** Como agente, quiero acceder al CRM y al asistente solo después de iniciar sesión, para que los datos de clientes y mis conversaciones permanezcan protegidos.

#### Criterios de Aceptación

1. EL Sistema_CRM DEBERÁ restringir el acceso a la Interfaz_Web a sesiones de Agente autenticadas.
2. SI una solicitud no autenticada alcanza el Backend_CRM, ENTONCES EL Backend_CRM DEBERÁ rechazar la solicitud y devolver un error de autorización.
3. CUANDO un Agente crea o consulta registros, EL Sistema_CRM DEBERÁ asociar los registros de Cliente, Registro_Actividad, Conversacion y Mensaje con el identificador del Agente propietario correspondiente.
4. DONDE un registro pertenezca a otro Agente, EL Backend_CRM DEBERÁ excluir ese registro de los resultados del Agente solicitante.

### Requisito 2: Gestión de clientes (CRUD)

**Historia de usuario:** Como agente, quiero crear, editar, eliminar y listar clientes, para mantener mi cartera de contactos organizada.

#### Criterios de Aceptación

1. CUANDO un Agente envía un formulario de creación con nombre y correo electrónico válidos, EL Backend_CRM DEBERÁ crear un registro de Cliente con los campos nombre, correo electrónico, teléfono, empresa, Estado_Cliente y notas, y persistirlo mediante Prisma.
2. SI el campo nombre o el campo correo electrónico está vacío al crear o editar un Cliente, ENTONCES EL Backend_CRM DEBERÁ rechazar la operación y devolver un error de validación.
3. SI el valor del campo correo electrónico no cumple el formato de dirección de correo electrónico, ENTONCES EL Backend_CRM DEBERÁ rechazar la operación y devolver un error de validación.
4. CUANDO un Agente edita un Cliente existente del que es propietario, EL Backend_CRM DEBERÁ actualizar los campos proporcionados y persistir los cambios mediante Prisma.
5. CUANDO un Agente elimina un Cliente del que es propietario, EL Backend_CRM DEBERÁ eliminar el registro de Cliente y sus Registro_Actividad asociados.
6. CUANDO un Agente abre la vista de listado, EL Sistema_CRM DEBERÁ mostrar los Cliente de los que el Agente es propietario ordenados por actividad más reciente.

### Requisito 3: Búsqueda de clientes

**Historia de usuario:** Como agente, quiero buscar entre mis clientes, para localizar un contacto rápidamente.

#### Criterios de Aceptación

1. CUANDO un Agente envía un término de búsqueda, EL Backend_CRM DEBERÁ devolver los Cliente del Agente cuyo nombre, correo electrónico o empresa contengan el término de búsqueda sin distinguir mayúsculas de minúsculas.
2. SI ningún Cliente coincide con el término de búsqueda, ENTONCES EL Sistema_CRM DEBERÁ mostrar un mensaje en español que indique que no se encontraron resultados.

### Requisito 4: Registro de actividad y notas por cliente

**Historia de usuario:** Como agente, quiero registrar notas y actividad para cada cliente, para conservar el historial de interacciones.

#### Criterios de Aceptación

1. CUANDO un Agente añade una entrada de actividad o nota a un Cliente del que es propietario, EL Backend_CRM DEBERÁ crear un Registro_Actividad asociado a ese Cliente con marca de tiempo y contenido, persistido mediante Prisma.
2. CUANDO un Agente abre el detalle de un Cliente, EL Sistema_CRM DEBERÁ mostrar los Registro_Actividad asociados en orden cronológico.
3. SI el contenido de la entrada de actividad está vacío, ENTONCES EL Backend_CRM DEBERÁ rechazar la operación y devolver un error de validación.

### Requisito 5: Asistente de IA conversacional con respuestas transmitidas

**Historia de usuario:** Como agente, quiero enviar un mensaje al asistente y ver la respuesta aparecer progresivamente, para obtener retroalimentación más rápida durante respuestas largas.

#### Criterios de Aceptación

1. CUANDO un Agente envía un mensaje a través de la Interfaz_Chat, EL Backend_CRM DEBERÁ enviar el mensaje junto con el contexto de la conversación al Proveedor_Claude.
2. CUANDO el Proveedor_Claude devuelve tokens de respuesta, EL Backend_CRM DEBERÁ transmitir los tokens a la Interfaz_Chat a medida que se reciben.
3. MIENTRAS una respuesta se está transmitiendo, LA Interfaz_Chat DEBERÁ representar los tokens entrantes de forma incremental en la conversación activa.
4. CUANDO la respuesta transmitida se completa, EL Backend_CRM DEBERÁ persistir el Mensaje completo del asistente en la Conversacion.
5. SI el contenido del mensaje enviado está vacío, ENTONCES EL Backend_CRM DEBERÁ rechazar el envío y devolver un error de validación.

### Requisito 6: Asistencia para redactar y resumir información de clientes

**Historia de usuario:** Como agente, quiero que el asistente me ayude a redactar mensajes y a resumir la información de un cliente, para trabajar con mayor eficiencia.

#### Criterios de Aceptación

1. CUANDO un Agente solicita al Asistente_IA redactar un mensaje para un Cliente del que es propietario, EL Backend_CRM DEBERÁ incluir los datos de ese Cliente en el contexto enviado al Proveedor_Claude y devolver el borrador transmitido a la Interfaz_Chat.
2. CUANDO un Agente solicita al Asistente_IA un resumen de un Cliente del que es propietario, EL Backend_CRM DEBERÁ incluir los campos del Cliente y sus Registro_Actividad en el contexto enviado al Proveedor_Claude.
3. DONDE la solicitud del asistente referencie un Cliente que no pertenece al Agente, EL Backend_CRM DEBERÁ rechazar la solicitud y devolver un error de autorización.

### Requisito 7: Persistencia y recuperación de conversaciones

**Historia de usuario:** Como agente, quiero que mis conversaciones pasadas se almacenen y se puedan recuperar, para continuarlas o revisarlas más tarde.

#### Criterios de Aceptación

1. CUANDO un Agente envía el primer mensaje de una nueva conversación, EL Backend_CRM DEBERÁ crear un registro de Conversacion asociado a ese Agente.
2. CUANDO un Mensaje de usuario o un Mensaje del asistente se finaliza, EL Backend_CRM DEBERÁ persistir el Mensaje con su rol, contenido y Conversacion padre mediante Prisma.
3. CUANDO un Agente abre la Interfaz_Chat, EL Sistema_CRM DEBERÁ recuperar y mostrar las Conversacion existentes del Agente ordenadas por actividad más reciente.
4. CUANDO un Agente selecciona una Conversacion existente, EL Sistema_CRM DEBERÁ cargar y mostrar los Mensaje de esa Conversacion en orden cronológico.
5. DONDE una Conversacion pertenezca a otro Agente, EL Backend_CRM DEBERÁ excluir esa Conversacion de los resultados del Agente solicitante.

### Requisito 8: Configuración del modelo de Claude

**Historia de usuario:** Como operador, quiero que el modelo de Claude y la clave de API sean configurables mediante variables de entorno, para cambiar de modelo y proteger las credenciales sin modificar el código.

#### Criterios de Aceptación

1. EL Proveedor_Claude DEBERÁ leer el Identificador_Modelo desde una variable de entorno.
2. SI la variable de entorno del Identificador_Modelo no está definida, ENTONCES EL Proveedor_Claude DEBERÁ usar el valor por defecto `claude-3-5-sonnet`.
3. EL Proveedor_Claude DEBERÁ leer la Clave_API desde el archivo `.env` en tiempo de ejecución.
4. EL Sistema_CRM DEBERÁ excluir el archivo `.env` del control de versiones.
5. SI la Clave_API falta cuando se inicia una solicitud, ENTONCES EL Backend_CRM DEBERÁ devolver un error de configuración y DEBERÁ omitir la invocación del Proveedor_Claude.

### Requisito 9: Manejo de errores durante la interacción con el modelo

**Historia de usuario:** Como agente, quiero recibir retroalimentación clara cuando el asistente no puede responder, para comprender el estado de mi solicitud.

#### Criterios de Aceptación

1. SI el Proveedor_Claude devuelve una respuesta de error, ENTONCES EL Backend_CRM DEBERÁ devolver un indicador de error a la Interfaz_Chat y DEBERÁ conservar el Mensaje enviado por el Agente.
2. SI la conexión con el Proveedor_Claude se interrumpe durante la transmisión, ENTONCES EL Backend_CRM DEBERÁ finalizar la transmisión y DEBERÁ informar la interrupción a la Interfaz_Chat.
3. CUANDO la Interfaz_Chat recibe un indicador de error, LA Interfaz_Chat DEBERÁ mostrar un mensaje de error en español al Agente.

### Requisito 10: Automatización de salida hacia múltiples destinos mediante webhook

**Historia de usuario:** Como agente, quiero que el sistema notifique a una lista configurable de destinos externos cuando se crea o actualiza un cliente, para activar automatizaciones en Zapier, Make, n8n o un endpoint propio.

#### Criterios de Aceptación

1. CUANDO un Cliente se crea o se actualiza, EL Backend_CRM DEBERÁ enviar a cada Destino_Salida de la Lista_Destinos_Salida una solicitud HTTP POST cuyo cuerpo contenga el tipo de evento y la representación del Cliente.
2. EL Backend_CRM DEBERÁ construir la Lista_Destinos_Salida en tiempo de ejecución a partir de las URLs de la variable de entorno `OUTBOUND_WEBHOOK_URLS` separadas por comas o espacios en blanco más la URL del Webhook_Zapier_Salida heredada, eliminando las URLs duplicadas.
3. DONDE la Lista_Destinos_Salida esté vacía, EL Backend_CRM DEBERÁ omitir el envío de notificaciones y DEBERÁ completar la operación de Cliente.
4. SI la solicitud a un Destino_Salida falla, ENTONCES EL Backend_CRM DEBERÁ registrar el fallo, DEBERÁ continuar enviando la solicitud a los demás Destino_Salida de la Lista_Destinos_Salida y DEBERÁ completar la operación de Cliente.

### Requisito 11: Integración de entrada con Zapier mediante endpoint autenticado

**Historia de usuario:** Como integrador, quiero que Zapier pueda crear clientes en el CRM a través de un endpoint seguro, para automatizar el alta de contactos desde sistemas externos.

#### Criterios de Aceptación

1. CUANDO el Endpoint_Zapier_Entrada recibe una solicitud con un Token_Integracion válido y un nombre y correo electrónico válidos, EL Backend_CRM DEBERÁ crear un registro de Cliente y persistirlo mediante Prisma.
2. SI una solicitud al Endpoint_Zapier_Entrada carece de un Token_Integracion válido, ENTONCES EL Backend_CRM DEBERÁ rechazar la solicitud y devolver un error de autorización.
3. SI una solicitud al Endpoint_Zapier_Entrada omite el campo nombre o el campo correo electrónico, ENTONCES EL Backend_CRM DEBERÁ rechazar la solicitud y devolver un error de validación.
4. EL Backend_CRM DEBERÁ leer el Token_Integracion desde el archivo `.env` en tiempo de ejecución.

### Requisito 12: Interfaz de usuario en español

**Historia de usuario:** Como usuario hispanohablante, quiero que las etiquetas y los mensajes del producto estén en español, para que la experiencia coincida con mi idioma.

#### Criterios de Aceptación

1. LA Interfaz_Web DEBERÁ presentar las etiquetas, los botones y los mensajes de estado de cara al usuario en español.
2. CUANDO la Interfaz_Web muestra un mensaje de validación o de error, LA Interfaz_Web DEBERÁ presentar ese mensaje en español.

### Requisito 13: Semilla inicial de la base de datos

**Historia de usuario:** Como operador, quiero que la base de datos se inicialice con un cliente de demostración, para disponer de datos de ejemplo al desplegar el producto sin generar duplicados en ejecuciones sucesivas.

#### Criterios de Aceptación

1. CUANDO se ejecuta la Semilla_BD, EL Sistema_CRM DEBERÁ crear un Cliente_Demo con nombre "Kepa Bilbao" asociado a un Agente propietario y persistirlo mediante Prisma.
2. SI el Cliente_Demo con nombre "Kepa Bilbao" ya existe, ENTONCES LA Semilla_BD DEBERÁ omitir la creación del registro para evitar duplicados.
