/**
 * Catálogo central de cadenas en español (Requisitos 12.1, 12.2).
 *
 * Concentra todas las etiquetas, botones y mensajes de estado/validación que
 * muestran los componentes React, de modo que la interfaz se presente de forma
 * coherente y completamente en español. Los componentes deben consumir estas
 * claves en lugar de incrustar texto literal.
 *
 * El objeto se exporta como `as const` para obtener un catálogo tipado e
 * inmutable: cada valor queda fijado a su literal exacto, lo que permite
 * autocompletado y verificación de tipos en los puntos de uso.
 */
export const es = {
  /** Identidad y navegación general de la aplicación. */
  app: {
    title: 'CRM de Clientes',
    nav: {
      clients: 'Clientes',
      assistant: 'Asistente',
      logout: 'Cerrar sesión',
    },
  },

  /** Autenticación (inicio de sesión y registro). */
  auth: {
    loginTitle: 'Iniciar sesión',
    signupTitle: 'Crear cuenta',
    username: 'Usuario',
    password: 'Contraseña',
    loginButton: 'Iniciar sesión',
    signupButton: 'Registrarse',
    goToSignup: '¿No tienes cuenta? Regístrate',
    goToLogin: '¿Ya tienes cuenta? Inicia sesión',
  },

  /** Gestión de clientes: campos, acciones, búsqueda y estados. */
  clients: {
    pageTitle: 'Clientes',
    welcome: 'Bienvenido al CRM de Clientes.',
    newClient: 'Nuevo cliente',
    // Etiquetas de campos del formulario y del detalle de cliente.
    fields: {
      name: 'Nombre',
      email: 'Correo electrónico',
      phone: 'Teléfono',
      company: 'Empresa',
      status: 'Estado',
      notes: 'Notas',
    },
    // Botones de acción sobre clientes.
    actions: {
      save: 'Guardar',
      edit: 'Editar',
      delete: 'Eliminar',
      cancel: 'Cancelar',
      search: 'Buscar',
    },
    // Marcador y mensajes de la barra de búsqueda.
    search: {
      placeholder: 'Buscar por nombre, correo o empresa',
      noResults: 'No se encontraron resultados',
    },
    // Estados de carga y vacío del listado.
    loading: 'Cargando clientes…',
    empty: 'Aún no hay clientes. Crea el primero.',
    deleteConfirm: '¿Seguro que deseas eliminar este cliente?',
  },

  /** Registro de actividad y notas por cliente. */
  activity: {
    title: 'Actividad',
    addNote: 'Añadir nota',
    notePlaceholder: 'Escribe una nota o registro de actividad',
    save: 'Guardar nota',
    empty: 'Sin actividad registrada.',
    loading: 'Cargando actividad…',
  },

  /** Interfaz del asistente conversacional. */
  chat: {
    pageTitle: 'Asistente',
    intro: 'Conversa con el asistente de IA.',
    // Caja de composición del mensaje.
    composer: {
      placeholder: 'Escribe un mensaje…',
      send: 'Enviar',
    },
    // Indicadores de estado del streaming.
    status: {
      streaming: 'El asistente está escribiendo…',
      thinking: 'Pensando…',
      done: 'Respuesta completada',
    },
    // Listado e hilo de conversaciones.
    conversations: {
      title: 'Conversaciones',
      empty: 'Aún no hay conversaciones. Envía un mensaje para empezar.',
      loading: 'Cargando conversaciones…',
      newConversation: 'Nueva conversación',
    },
    // Acciones del asistente sobre un cliente.
    assistantActions: {
      draft: 'Redactar',
      summarize: 'Resumir',
    },
  },

  /**
   * Publicador de Vídeos IA: etiquetas, acciones, estados y errores propios de
   * la funcionalidad de publicación (Requisitos 9.1, 9.2). Sección aditiva que
   * no altera las claves existentes del CRM.
   */
  publisher: {
    pageTitle: 'Publicaciones',
    newPost: 'Nueva publicación',
    empty: 'Aún no hay publicaciones. Crea la primera.',
    loading: 'Cargando publicaciones…',
    // Etiquetas de campos del formulario de creación de publicación.
    fields: {
      videoUrl: 'URL del vídeo',
      fileRef: 'Referencia de archivo',
      brief: 'Resumen del tema',
      platforms: 'Plataformas',
    },
    // Botones de acción sobre publicaciones y contenidos por plataforma.
    actions: {
      create: 'Crear publicación',
      generate: 'Generar',
      regenerate: 'Regenerar',
      publish: 'Publicar',
      copy: 'Copiar texto',
      copied: 'Texto copiado',
    },
    // Etiquetas de estado de publicación por plataforma (Requisito 9.2).
    status: {
      pendiente: 'Pendiente',
      enviado: 'Enviado',
      error: 'Error',
      manual: 'Manual',
    },
    // Mensajes de validación específicos del publicador.
    errors: {
      videoUrlRequired: 'La URL del vídeo es obligatoria',
      platformRequired: 'Selecciona al menos una plataforma',
    },
  },

  /** Mensajes de error mostrados al usuario, todos en español (Requisito 12.2). */
  errors: {
    // Validación de mensaje vacío en el asistente (Requisito 5.5).
    emptyMessage: 'El mensaje no puede estar vacío',
    // Falta de configuración de la clave de API (Requisito 8.5).
    config: 'Falta la configuración de la clave de API',
    // Fallo de la API del proveedor / Claude (Requisito 9.1, 9.3).
    provider: 'El asistente no pudo responder',
    // Interrupción del flujo de tokens (Requisito 9.2).
    interrupted: 'La respuesta se interrumpió. Inténtalo de nuevo.',
    // Solicitud no autenticada (Requisito 1.2).
    unauthorized: 'No autorizado',
    // Acceso a un recurso ajeno o inexistente (Requisitos 1.4, 6.3, 7.5).
    resourceUnavailable: 'Recurso no disponible',
    // Errores de validación de cliente (Requisitos 2.2, 2.3).
    nameRequired: 'El nombre es obligatorio',
    emailRequired: 'El correo electrónico es obligatorio',
    emailInvalid: 'El formato del correo electrónico no es válido',
    // Error de validación de contenido de actividad (Requisito 4.3).
    activityContentRequired: 'El contenido de la actividad es obligatorio',
    // Error genérico de respaldo.
    generic: 'Ocurrió un error. Inténtalo de nuevo.',
  },
} as const

/** Tipo del catálogo de cadenas en español, derivado del objeto `es`. */
export type Catalogo = typeof es

export default es
