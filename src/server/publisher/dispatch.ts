// Despachador de salida generalizado (publicación)
//
// Difunde la Carga_Publicacion a TODOS los destinos de salida resueltos,
// REUTILIZANDO `resolverDestinos()` de la capa de automatización de salida
// existente (`src/server/integrations/outbound.ts`). El envío a cada destino es
// independiente: un fallo en uno se captura, se registra y NO impide los
// intentos a los demás (aislamiento de fallo por destino). Una respuesta HTTP
// no satisfactoria (`!res.ok`) también cuenta como fallo.
//
// Devuelve el recuento `{ total, fallidos }` para que la acción
// `publishPlatformContent` decida el Estado_Publicacion resultante.
//
// Requisitos cubiertos:
// - 5.1: POST de la Carga_Publicacion a cada destino de salida configurado.
// - 5.2: Reutiliza la lista deduplicada de destinos (`resolverDestinos`).
// - 5.4: Un fallo de un destino se captura y registra, marcando el envío como
//        fallido, sin impedir los intentos a los demás destinos.

import { resolverDestinos } from '../integrations/outbound.js'

export interface CargaPublicacion {
  platform: string
  videoUrl: string
  content: { title: string; description: string; hashtags: string }
}

export interface ResultadoEnvio {
  total: number
  fallidos: number
}

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
