/**
 * Stub de `wasp/server` para el entorno de pruebas.
 *
 * En este proyecto, el paquete `wasp` es un enlace simbólico a la salida
 * generada por Wasp (`.wasp/out/sdk/wasp`), que no existe fuera de un build
 * completo. Las pruebas no requieren el SDK real: solo necesitan `HttpError`
 * para que la lógica de dominio (validación, propiedad, autenticación) se
 * ejecute con la misma semántica que en producción.
 *
 * El `vitest.config.ts` redirige las importaciones de `wasp/server` a este
 * archivo mediante un alias de resolución.
 */

/** Réplica mínima y fiel de `HttpError` de Wasp. */
export class HttpError extends Error {
  public statusCode: number
  public data?: unknown

  constructor(statusCode: number, message?: string, data?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.data = data
  }
}
