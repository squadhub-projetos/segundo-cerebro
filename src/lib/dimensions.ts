import type { ContentType } from '../types'

export interface Size {
  w: number
  h: number
}

/**
 * Caixa de cada tipo de nó. É fixa por tipo (não muda com o zoom), então layout, posicionamento
 * e ancoragem das arestas usam sempre a mesma geometria.
 */
export const NODE_SIZE: Record<ContentType, Size> = {
  curso: { w: 320, h: 214 },
  pagina: { w: 280, h: 136 },
  criativo: { w: 260, h: 196 },
  aula: { w: 240, h: 96 },
  infoproduto: { w: 320, h: 214 },
  youtube: { w: 260, h: 176 },
}

export const sizeOf = (type: ContentType): Size => NODE_SIZE[type]

/** Raio dos cantos de cada tipo de nó (igual a --node-radius no CSS). */
export const NODE_RADIUS: Record<ContentType, number> = {
  curso: 24,
  pagina: 18,
  criativo: 16,
  aula: 14,
  infoproduto: 24,
  youtube: 16,
}
