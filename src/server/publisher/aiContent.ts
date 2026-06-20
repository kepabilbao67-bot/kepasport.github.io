// Capa de IA del Publicador de Vídeos IA
//
// Genera el contenido adaptado a cada plataforma (título, descripción y
// hashtags) reutilizando la integración con Claude ya existente
// (`streamCompletion`). A diferencia del chat, la generación NO transmite
// tokens al usuario: necesita el texto completo para parsearlo en
// `{ title, description, hashtags }`. Por ello `generateText` consume el async
// generator `streamCompletion` y ensambla la cadena completa.
//
// Requisitos:
// - 3.1: Genera contenido por plataforma.
// - 3.2: El prompt incluye el tono y los límites de la plataforma.
// - 3.3: El contenido generado incluye título, descripción y hashtags.
// - 3.5 / 7.3 / 8.3: La guarda de la clave de API vive dentro de
//        `streamCompletion` (HttpError 500 si falta ANTHROPIC_API_KEY); aquí no
//        se duplica.

import { streamCompletion } from '../chat/claudeProvider.js'
import { platformGuides, type Platform } from './platforms.js'

export interface ContenidoGenerado {
  title: string
  description: string
  hashtags: string
}

/**
 * Ayudante NO-streaming: reutiliza `streamCompletion` y ensambla el texto
 * completo. La guarda de clave de API vive dentro de `streamCompletion`, que
 * lanza HttpError(500) si falta ANTHROPIC_API_KEY (Req 3.5, 7.3, 8.3); por eso
 * aquí no se duplica la comprobación.
 */
export async function generateText(prompt: string): Promise<string> {
  let texto = ''
  for await (const token of streamCompletion([{ role: 'user', content: prompt }])) {
    texto += token
  }
  return texto
}

/**
 * Construye el prompt incluyendo la guía de tono y de límites de la plataforma,
 * la URL del vídeo y el brief, e instruye a Claude para que devuelva un JSON con
 * las claves "title", "description" y "hashtags" (Req 3.2).
 */
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

/**
 * Normaliza un valor arbitrario a una cadena. Las cadenas se devuelven tal cual;
 * los arrays (por ejemplo hashtags como lista) se unen por espacios; el resto se
 * serializa de forma segura. `null`/`undefined` se convierten en cadena vacía.
 */
function aTexto(valor: unknown): string {
  if (valor == null) return ''
  if (typeof valor === 'string') return valor
  if (Array.isArray(valor)) return valor.map(aTexto).filter(Boolean).join(' ')
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  try {
    return JSON.stringify(valor)
  } catch {
    return ''
  }
}

/**
 * Extrae el primer bloque `{...}` equilibrado de un texto, tolerando vallas de
 * código (```json ... ```) y texto adicional alrededor. Devuelve la subcadena
 * candidata a JSON o `null` si no se encuentra un bloque equilibrado.
 */
function extraerBloqueJson(salida: string): string | null {
  const inicio = salida.indexOf('{')
  if (inicio === -1) return null

  let profundidad = 0
  let enCadena = false
  let comilla = ''
  let escapado = false

  for (let i = inicio; i < salida.length; i++) {
    const c = salida[i]

    if (enCadena) {
      if (escapado) {
        escapado = false
      } else if (c === '\\') {
        escapado = true
      } else if (c === comilla) {
        enCadena = false
      }
      continue
    }

    if (c === '"' || c === "'") {
      enCadena = true
      comilla = c
    } else if (c === '{') {
      profundidad++
    } else if (c === '}') {
      profundidad--
      if (profundidad === 0) {
        return salida.slice(inicio, i + 1)
      }
    }
  }

  return null
}

/**
 * Extrae un campo por sección cuando el JSON no es válido. Busca etiquetas como
 * `title:` / `título:` / `Título -` al comienzo de una línea y devuelve el resto
 * de esa línea. Tolerante a mayúsculas/acentos y a separadores `:` o `-`.
 */
function extraerSeccion(salida: string, etiquetas: string[]): string {
  const lineas = salida.split(/\r?\n/)
  for (const linea of lineas) {
    for (const etiqueta of etiquetas) {
      const re = new RegExp(`^\\s*[-*#>\\s]*${etiqueta}\\s*[:\\-]\\s*(.+)$`, 'i')
      const m = linea.match(re)
      if (m && m[1]) {
        // Quita comillas o asteriscos de adorno alrededor del valor.
        return m[1].trim().replace(/^["'*]+|["'*]+$/g, '').trim()
      }
    }
  }
  return ''
}

/**
 * Interpreta la respuesta de Claude. Es tolerante:
 *   1. Intenta `JSON.parse` directo y, si falla, extrae el primer bloque `{...}`
 *      equilibrado (maneja vallas de código y texto extra) y lo parsea.
 *   2. Si el parseo JSON falla, recurre a una extracción por secciones.
 * SIEMPRE devuelve los tres campos como cadenas (cadena vacía como respaldo)
 * para mantener una forma estable (Req 3.3).
 */
export function parseContenido(salida: string): ContenidoGenerado {
  const texto = typeof salida === 'string' ? salida : ''

  const intentarJson = (candidato: string): ContenidoGenerado | null => {
    try {
      const obj = JSON.parse(candidato)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const o = obj as Record<string, unknown>
        return {
          title: aTexto(o.title ?? o.titulo ?? o['título']),
          description: aTexto(o.description ?? o.descripcion ?? o['descripción']),
          hashtags: aTexto(o.hashtags ?? o.tags),
        }
      }
    } catch {
      // cae al siguiente intento
    }
    return null
  }

  // 1) JSON directo.
  const directo = intentarJson(texto.trim())
  if (directo) return directo

  // 2) Bloque {...} embebido (vallas de código / texto extra).
  const bloque = extraerBloqueJson(texto)
  if (bloque) {
    const desdeBloque = intentarJson(bloque)
    if (desdeBloque) return desdeBloque
  }

  // 3) Respaldo: extracción por secciones; siempre devuelve los tres campos.
  return {
    title: extraerSeccion(texto, ['title', 'titulo', 'título']),
    description: extraerSeccion(texto, ['description', 'descripcion', 'descripción']),
    hashtags: extraerSeccion(texto, ['hashtags', 'tags', 'etiquetas']),
  }
}

/**
 * Genera y parsea el contenido por plataforma (Req 3.1, 3.2, 3.3). Construye el
 * prompt, obtiene la salida completa de Claude y la convierte en
 * `ContenidoGenerado`.
 */
export async function generateContentForPlatform(
  brief: string,
  videoUrl: string,
  platform: Platform
): Promise<ContenidoGenerado> {
  const prompt = buildPrompt(brief, videoUrl, platform)
  const salida = await generateText(prompt)
  return parseContenido(salida)
}
