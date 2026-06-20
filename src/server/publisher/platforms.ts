export type Platform =
  | 'linkedin' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'fiverr'

export type PlatformKind = 'automatizada' | 'manual'

export interface PlatformGuide {
  label: string          // etiqueta en español para la interfaz
  kind: PlatformKind     // automatizada (vía webhook) o manual (copiar)
  tone: string           // guía de tono incluida en el prompt
  limits: string         // guía de límites/longitud incluida en el prompt
}

export const platformGuides: Record<Platform, PlatformGuide> = {
  linkedin:  { label: 'LinkedIn',  kind: 'automatizada',
               tone: 'profesional y orientado a negocio',
               limits: 'texto medio, 1-3 hashtags relevantes' },
  instagram: { label: 'Instagram', kind: 'automatizada',
               tone: 'informal y cercano',
               limits: 'descripción breve con varios hashtags' },
  youtube:   { label: 'YouTube',   kind: 'automatizada',
               tone: 'descriptivo y claro',
               limits: 'título atractivo + descripción extensa' },
  x:         { label: 'X/Twitter', kind: 'automatizada',
               tone: 'directo y conciso',
               limits: 'texto muy breve (<= 280 caracteres)' },
  tiktok:    { label: 'TikTok',    kind: 'automatizada',
               tone: 'informal y dinámico',
               limits: 'descripción corta con hashtags de tendencia' },
  fiverr:    { label: 'Fiverr',    kind: 'manual',
               tone: 'estilo anuncio de servicio (gig)',
               limits: 'título de servicio + descripción de oferta' },
}

export const PLATAFORMAS: Platform[] = Object.keys(platformGuides) as Platform[]

export function esManual(p: Platform): boolean {
  return platformGuides[p].kind === 'manual'
}
