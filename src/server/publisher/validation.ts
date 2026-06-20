import { HttpError } from 'wasp/server'

/**
 * Entrada de datos para crear una Publicacion_Video.
 *
 * - `videoUrl` es la URL de la Fuente_Video (obligatoria, Req 2.1/2.3).
 * - `fileRef` es una referencia opcional a un archivo subido (Req 2.2).
 * - `brief` es el resumen del tema (Req 2.1).
 * - `platforms` es el conjunto de plataformas objetivo (al menos una, Req 2.4).
 */
export type PublicacionInput = {
  videoUrl: string
  fileRef?: string
  brief: string
  platforms: string[]
}

/**
 * Valida la entrada de creación de una Publicacion_Video antes de persistirla.
 *
 * - La URL del vídeo es obligatoria y no puede estar vacía ni compuesta solo
 *   por espacios en blanco (Requisitos 2.3, 7.1).
 * - Debe seleccionarse al menos una plataforma (Requisitos 2.4, 7.1).
 *
 * Lanza `HttpError(400)` con un mensaje en español cuando la validación falla.
 */
export function validatePublicacion(input: PublicacionInput): void {
  if (!input.videoUrl?.trim()) {
    throw new HttpError(400, 'La URL del vídeo es obligatoria')
  }
  if (!input.platforms || input.platforms.length === 0) {
    throw new HttpError(400, 'Selecciona al menos una plataforma')
  }
}
