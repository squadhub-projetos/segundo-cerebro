import type { DetailLevel } from '../components/ContentNode'

/**
 * Limites do zoom semântico, com histerese: subir de nível exige passar do limite "up" e descer
 * exige cair abaixo do limite "down", que é menor. Evita alternância perto da fronteira.
 */
export const ZOOM_LIMITS = {
  midUp: 0.66,
  midDown: 0.58,
  nearUp: 1.05,
  nearDown: 0.95,
} as const

export function levelForZoom(zoom: number): DetailLevel {
  if (zoom >= ZOOM_LIMITS.nearUp) return 'near'
  if (zoom >= ZOOM_LIMITS.midUp) return 'mid'
  return 'far'
}

export function nextLevel(prev: DetailLevel, zoom: number): DetailLevel {
  if (prev === 'far') return zoom >= ZOOM_LIMITS.midUp ? levelForZoom(zoom) : 'far'
  if (prev === 'mid') {
    if (zoom < ZOOM_LIMITS.midDown) return 'far'
    return zoom >= ZOOM_LIMITS.nearUp ? 'near' : 'mid'
  }
  if (zoom >= ZOOM_LIMITS.nearDown) return 'near'
  return zoom < ZOOM_LIMITS.midDown ? 'far' : 'mid'
}

/**
 * Abaixo deste zoom os cards são pequenos demais para um gesto preciso: não se criam conexões pelo contorno
 * (sem indicador, sem faixa magnética, sem início de arraste). Conexões existentes não são afetadas.
 * Fica abaixo do limite do nível "intermediário" (0,58 a 0,66), então só o zoom realmente distante desliga o recurso.
 */
export const CONNECTION_INTERACTION_MIN_ZOOM = 0.5
