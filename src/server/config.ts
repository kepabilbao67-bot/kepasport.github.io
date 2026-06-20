// Gestor de Configuración
//
// Centraliza la lectura de los secretos y parámetros del backend desde las
// variables de entorno (cargadas por Wasp desde `.env.server` en tiempo de
// ejecución). Cada valor se expone como una función para que se lea en el
// momento de uso y no quede congelado al importar el módulo.
//
// Requisitos:
// - 8.1, 8.2: Identificador del modelo de Claude (por defecto `claude-3-5-sonnet`).
// - 10.2:     URL del webhook de salida de Zapier.
// - 11.4:     Token del endpoint de entrada de Zapier.
//
// Automatización de salida genérica:
// - `OUTBOUND_WEBHOOK_URLS` permite configurar una lista de destinos (separados
//   por comas y/o espacios) para notificar a CUALQUIER sistema externo (Make,
//   n8n, HTTP propio, etc.), además del `ZAPIER_WEBHOOK_URL` heredado.

export const config = {
  anthropicApiKey: (): string | undefined => process.env.ANTHROPIC_API_KEY,
  // Requisitos 8.1, 8.2: el identificador de modelo se lee de CLAUDE_MODEL.
  // Una variable ausente, vacía o compuesta solo por espacios se trata como
  // "sin configurar" y recurre al valor por defecto `claude-3-5-sonnet`.
  claudeModel: (): string => {
    const m = process.env.CLAUDE_MODEL?.trim()
    return m && m.length > 0 ? m : 'claude-3-5-sonnet'
  },
  zapierWebhookUrl: (): string | undefined => process.env.ZAPIER_WEBHOOK_URL, // Requisito 10.2
  zapierToken: (): string | undefined => process.env.ZAPIER_INBOUND_TOKEN, // Requisito 11.4

  // Lista de destinos de salida genéricos leída de `OUTBOUND_WEBHOOK_URLS`.
  // Acepta URLs separadas por comas y/o espacios en blanco (saltos de línea
  // incluidos). Se descartan las entradas vacías. Si la variable está ausente o
  // no contiene ninguna URL, devuelve un arreglo vacío. No deduplica: esa
  // responsabilidad recae en la capa de despacho, que también combina esta
  // lista con `zapierWebhookUrl()` y elimina duplicados.
  outboundWebhookUrls: (): string[] => {
    const raw = process.env.OUTBOUND_WEBHOOK_URLS
    if (!raw) return []
    return raw
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
  },
}
