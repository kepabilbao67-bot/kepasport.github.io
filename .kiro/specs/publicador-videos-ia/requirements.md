# Documento de Requisitos

## Introducción

"Publicador de Vídeos IA" es un producto construido sobre la misma aplicación Wasp que ya contiene el CRM de clientes (frontend React, backend Node.js mediante operaciones de Wasp, persistencia con Prisma y TypeScript). El producto permite a un usuario autenticado preparar y publicar un vídeo en varias plataformas sociales (LinkedIn, Instagram, YouTube, X/Twitter y TikTok) y preparar contenido para Fiverr, generando con el asistente de IA basado en el modelo Claude de Anthropic un contenido adaptado a cada plataforma (título, descripción y hashtags) según su tono y sus límites.

Cada usuario solo ve sus propias publicaciones de vídeo (aislamiento por propietario, reutilizando la autenticación de Wasp). El usuario indica la fuente del vídeo (un enlace/URL y, opcionalmente, una referencia a un archivo subido) y un breve resumen del tema, y selecciona las plataformas objetivo. La publicación efectiva se delega a la capa genérica de automatización de salida existente (`OUTBOUND_WEBHOOK_URLS`, por ejemplo Make o n8n), que realiza la publicación real en cada red; el producto no requiere OAuth real contra cada red en su núcleo (MVP). Para Fiverr y cualquier plataforma manual, el usuario puede copiar el texto generado para publicarlo por su cuenta.

El producto rastrea un estado de publicación por plataforma (pendiente, enviado, error, manual). Toda la interfaz de cara al usuario y los mensajes de validación y error se presentan en español. El modelo de Claude, la clave de API y los destinos de salida se configuran mediante variables de entorno (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `OUTBOUND_WEBHOOK_URLS`) almacenadas en `.env`, excluido del control de versiones.

## Glosario

- **Sistema_Publicador**: La capacidad de extremo a extremo del producto, incluyendo la interfaz React, las operaciones del backend de Wasp, la persistencia con Prisma y las integraciones con Claude y los destinos de salida.
- **Interfaz_Publicador**: El conjunto de componentes del frontend React mediante los cuales un Usuario crea publicaciones de vídeo, genera contenido, revisa variantes y publica.
- **Backend_Publicador**: Las operaciones y acciones de Wasp/Node.js que procesan las solicitudes de creación, generación de contenido, persistencia y publicación.
- **Usuario**: Una persona que ha completado el flujo de inicio de sesión de Wasp y posee una sesión válida.
- **Publicacion_Video**: Entidad Prisma que representa una publicación de vídeo, con los campos Fuente_Video, Brief, conjunto de Plataforma_Objetivo seleccionadas, marca de tiempo de creación y el identificador del Usuario propietario.
- **Fuente_Video**: El origen del vídeo asociado a una Publicacion_Video, compuesto por una URL/enlace al vídeo y, opcionalmente, una referencia a un archivo subido.
- **Brief**: El texto breve proporcionado por el Usuario que describe el tema o el propósito del vídeo y que orienta la generación de contenido.
- **Plataforma_Objetivo**: Una plataforma de destino seleccionable para una Publicacion_Video; el conjunto admitido es LinkedIn, Instagram, YouTube, X/Twitter, TikTok y Fiverr.
- **Plataforma_Automatizada**: Una Plataforma_Objetivo cuya publicación se delega a un Destino_Salida (LinkedIn, Instagram, YouTube, X/Twitter, TikTok).
- **Plataforma_Manual**: Una Plataforma_Objetivo cuya publicación realiza el Usuario manualmente copiando el texto generado (Fiverr y cualquier plataforma sin Destino_Salida disponible).
- **Contenido_Plataforma**: Entidad Prisma que representa la variante de contenido generada para una Plataforma_Objetivo concreta de una Publicacion_Video, con los campos título/encabezado, descripción/texto, hashtags, Estado_Publicacion y la Plataforma_Objetivo a la que pertenece.
- **Asistente_IA**: La capacidad de generación de contenido basada en el modelo Claude, integrada en el producto, que redacta el contenido adaptado a cada plataforma.
- **Proveedor_Claude**: La capa de integración existente (`streamCompletion`) que envía solicitudes a la API de Claude de Anthropic y recibe respuestas.
- **Estado_Publicacion**: El estado de publicación de un Contenido_Plataforma, con los valores `pendiente`, `enviado`, `error` o `manual`.
- **Destino_Salida**: Un sistema externo de automatización (por ejemplo Make, n8n o un endpoint HTTP propio) identificado por una URL de webhook al que el Backend_Publicador envía la carga de publicación para que realice la publicación real en la red.
- **Lista_Destinos_Salida**: El conjunto deduplicado de URLs de Destino_Salida resuelto en tiempo de ejecución a partir de la variable de entorno `OUTBOUND_WEBHOOK_URLS` (separadas por comas o espacios en blanco).
- **Carga_Publicacion**: El cuerpo HTTP JSON que el Backend_Publicador envía a un Destino_Salida, compuesto por la URL de la Fuente_Video, la Plataforma_Objetivo y el Contenido_Plataforma generado para esa plataforma.
- **Identificador_Modelo**: El nombre configurable del modelo de Claude (valor por defecto `claude-3-5-sonnet`) leído desde la variable de entorno `CLAUDE_MODEL`.
- **Clave_API**: La credencial de la API de Anthropic (`ANTHROPIC_API_KEY`) almacenada en el archivo `.env` y excluida del control de versiones.

## Requisitos

### Requisito 1: Acceso autenticado y aislamiento por propietario

**Historia de usuario:** Como usuario, quiero acceder al publicador solo después de iniciar sesión y ver únicamente mis propias publicaciones, para que mi contenido permanezca protegido y separado del de otros usuarios.

#### Criterios de Aceptación

1. EL Sistema_Publicador DEBERÁ restringir el acceso a la Interfaz_Publicador a sesiones de Usuario autenticadas.
2. SI una solicitud no autenticada alcanza el Backend_Publicador, ENTONCES EL Backend_Publicador DEBERÁ rechazar la solicitud y devolver un error de autorización.
3. CUANDO un Usuario crea una Publicacion_Video, EL Backend_Publicador DEBERÁ asociar la Publicacion_Video y sus Contenido_Plataforma con el identificador del Usuario propietario.
4. DONDE una Publicacion_Video pertenezca a otro Usuario, EL Backend_Publicador DEBERÁ excluir esa Publicacion_Video de los resultados del Usuario solicitante.
5. SI un Usuario solicita una operación sobre una Publicacion_Video que no le pertenece, ENTONCES EL Backend_Publicador DEBERÁ rechazar la solicitud y devolver un error de autorización.

### Requisito 2: Creación de una publicación de vídeo

**Historia de usuario:** Como usuario, quiero crear una publicación indicando la fuente del vídeo, un breve resumen y las plataformas objetivo, para preparar su difusión.

#### Criterios de Aceptación

1. CUANDO un Usuario envía un formulario de creación con una URL de Fuente_Video válida, un Brief y al menos una Plataforma_Objetivo seleccionada, EL Backend_Publicador DEBERÁ crear una Publicacion_Video y persistirla mediante Prisma.
2. DONDE el Usuario adjunte una referencia a un archivo subido, EL Backend_Publicador DEBERÁ almacenar esa referencia como parte de la Fuente_Video de la Publicacion_Video.
3. SI el campo de la URL de la Fuente_Video está vacío al crear una Publicacion_Video, ENTONCES EL Backend_Publicador DEBERÁ rechazar la operación y devolver un error de validación en español.
4. SI el Usuario no selecciona ninguna Plataforma_Objetivo al crear una Publicacion_Video, ENTONCES EL Backend_Publicador DEBERÁ rechazar la operación y devolver un error de validación en español.
5. CUANDO un Usuario crea una Publicacion_Video, EL Backend_Publicador DEBERÁ inicializar un Contenido_Plataforma con Estado_Publicacion `pendiente` por cada Plataforma_Objetivo seleccionada.

### Requisito 3: Generación de contenido por plataforma con IA

**Historia de usuario:** Como usuario, quiero que el asistente genere automáticamente el título, la descripción y los hashtags adaptados a cada plataforma, para publicar contenido apropiado sin redactarlo manualmente.

#### Criterios de Aceptación

1. CUANDO un Usuario solicita generar el contenido de una Plataforma_Objetivo de una Publicacion_Video de la que es propietario, EL Backend_Publicador DEBERÁ enviar el Brief, la Fuente_Video y la Plataforma_Objetivo al Proveedor_Claude y DEBERÁ producir un Contenido_Plataforma con título/encabezado, descripción/texto y hashtags.
2. EL Backend_Publicador DEBERÁ adaptar el contenido generado al tono y a los límites de cada Plataforma_Objetivo, aplicando un estilo profesional para LinkedIn, un estilo informal con hashtags para Instagram, un título con descripción para YouTube, un texto breve para X/Twitter, un estilo informal para TikTok y un estilo de anuncio de servicio para Fiverr.
3. CUANDO la generación de una Plataforma_Objetivo finaliza correctamente, EL Backend_Publicador DEBERÁ persistir el Contenido_Plataforma generado mediante Prisma.
4. CUANDO un Usuario solicita regenerar el contenido de una Plataforma_Objetivo ya generada, EL Backend_Publicador DEBERÁ reemplazar el título/encabezado, la descripción/texto y los hashtags de ese Contenido_Plataforma con el resultado de la nueva generación.
5. SI la Clave_API falta cuando se solicita una generación, ENTONCES EL Backend_Publicador DEBERÁ devolver un error de configuración en español y DEBERÁ omitir la invocación del Proveedor_Claude.
6. SI el Proveedor_Claude devuelve una respuesta de error durante una generación, ENTONCES EL Backend_Publicador DEBERÁ devolver un indicador de error a la Interfaz_Publicador y DEBERÁ conservar el Contenido_Plataforma previo de esa Plataforma_Objetivo.

### Requisito 4: Persistencia, listado y consulta de publicaciones

**Historia de usuario:** Como usuario, quiero que mis publicaciones y sus variantes por plataforma se guarden y se puedan consultar, para revisarlas y reutilizarlas más tarde.

#### Criterios de Aceptación

1. CUANDO un Usuario abre la vista de listado, EL Sistema_Publicador DEBERÁ mostrar las Publicacion_Video de las que el Usuario es propietario ordenadas por fecha de creación más reciente primero.
2. CUANDO un Usuario abre el detalle de una Publicacion_Video de la que es propietario, EL Sistema_Publicador DEBERÁ mostrar la Fuente_Video, el Brief y los Contenido_Plataforma asociados con su Estado_Publicacion.
3. CUANDO un Contenido_Plataforma se genera o se actualiza, EL Backend_Publicador DEBERÁ persistir su título/encabezado, descripción/texto, hashtags, Plataforma_Objetivo y Estado_Publicacion mediante Prisma.

### Requisito 5: Publicación mediante automatización de salida genérica

**Historia de usuario:** Como usuario, quiero publicar el vídeo en las plataformas automatizadas a través de las automatizaciones configuradas, para difundir el contenido sin operar cada red manualmente.

#### Criterios de Aceptación

1. CUANDO un Usuario solicita publicar un Contenido_Plataforma de una Plataforma_Automatizada y la Lista_Destinos_Salida no está vacía, EL Backend_Publicador DEBERÁ enviar a cada Destino_Salida de la Lista_Destinos_Salida una solicitud HTTP POST cuyo cuerpo sea la Carga_Publicacion.
2. EL Backend_Publicador DEBERÁ construir la Lista_Destinos_Salida en tiempo de ejecución a partir de las URLs de la variable de entorno `OUTBOUND_WEBHOOK_URLS` separadas por comas o espacios en blanco, eliminando las URLs duplicadas.
3. CUANDO el envío de la Carga_Publicacion a la Lista_Destinos_Salida se completa, EL Backend_Publicador DEBERÁ asignar el Estado_Publicacion `enviado` al Contenido_Plataforma correspondiente.
4. SI la solicitud a un Destino_Salida falla, ENTONCES EL Backend_Publicador DEBERÁ registrar el fallo, DEBERÁ asignar el Estado_Publicacion `error` al Contenido_Plataforma correspondiente y DEBERÁ continuar enviando la solicitud a los demás Destino_Salida de la Lista_Destinos_Salida.
5. DONDE la Lista_Destinos_Salida esté vacía al solicitar la publicación de una Plataforma_Automatizada, EL Backend_Publicador DEBERÁ omitir el envío y DEBERÁ asignar el Estado_Publicacion `manual` al Contenido_Plataforma correspondiente.

### Requisito 6: Copia manual para Fiverr y plataformas manuales

**Historia de usuario:** Como usuario, quiero copiar el texto generado para las plataformas manuales, para publicarlo yo mismo cuando no exista una automatización.

#### Criterios de Aceptación

1. CUANDO un Usuario abre el detalle de un Contenido_Plataforma de una Plataforma_Manual, LA Interfaz_Publicador DEBERÁ mostrar el título/encabezado, la descripción/texto y los hashtags generados junto con un control para copiar el texto.
2. CUANDO un Usuario activa el control de copia de un Contenido_Plataforma, LA Interfaz_Publicador DEBERÁ copiar al portapapeles el título/encabezado, la descripción/texto y los hashtags de ese Contenido_Plataforma.
3. EL Backend_Publicador DEBERÁ asignar el Estado_Publicacion `manual` a cada Contenido_Plataforma de una Plataforma_Manual.

### Requisito 7: Validación y manejo de errores en español

**Historia de usuario:** Como usuario hispanohablante, quiero recibir mensajes de validación y de error claros en español, para comprender qué debo corregir.

#### Criterios de Aceptación

1. CUANDO el Backend_Publicador rechaza una operación por una entrada inválida, EL Backend_Publicador DEBERÁ devolver un mensaje de error de validación en español que identifique el campo afectado.
2. CUANDO la Interfaz_Publicador recibe un indicador de error del Backend_Publicador, LA Interfaz_Publicador DEBERÁ mostrar un mensaje de error en español al Usuario.
3. SI ocurre un error de configuración por falta de la Clave_API, ENTONCES EL Backend_Publicador DEBERÁ devolver un mensaje de error de configuración en español.

### Requisito 8: Configuración mediante variables de entorno

**Historia de usuario:** Como operador, quiero que el modelo de Claude, la clave de API y los destinos de salida sean configurables mediante variables de entorno, para cambiar la configuración y proteger las credenciales sin modificar el código.

#### Criterios de Aceptación

1. EL Proveedor_Claude DEBERÁ leer el Identificador_Modelo desde la variable de entorno `CLAUDE_MODEL`.
2. SI la variable de entorno `CLAUDE_MODEL` no está definida o está vacía, ENTONCES EL Proveedor_Claude DEBERÁ usar el valor por defecto `claude-3-5-sonnet`.
3. EL Backend_Publicador DEBERÁ leer la Clave_API desde la variable de entorno `ANTHROPIC_API_KEY` en tiempo de ejecución.
4. EL Backend_Publicador DEBERÁ leer la Lista_Destinos_Salida desde la variable de entorno `OUTBOUND_WEBHOOK_URLS` en tiempo de ejecución.
5. EL Sistema_Publicador DEBERÁ excluir el archivo `.env` del control de versiones.

### Requisito 9: Interfaz de usuario en español

**Historia de usuario:** Como usuario hispanohablante, quiero que las etiquetas y los mensajes del producto estén en español, para que la experiencia coincida con mi idioma.

#### Criterios de Aceptación

1. LA Interfaz_Publicador DEBERÁ presentar las etiquetas, los botones y los mensajes de estado de cara al usuario en español.
2. CUANDO la Interfaz_Publicador muestra el Estado_Publicacion de un Contenido_Plataforma, LA Interfaz_Publicador DEBERÁ presentar el estado en español.
