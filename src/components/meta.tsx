import { BookOpen, Clapperboard, GraduationCap, Megaphone, PanelsTopLeft, Package } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ContentStatus, ContentType } from '../types'
import { COLLECTIONS } from '../lib/mock'

export const TYPE_META: Record<ContentType, { label: string; plural: string; Icon: LucideIcon }> = {
  criativo: { label: 'Criativo', plural: 'Criativos', Icon: Megaphone },
  pagina: { label: 'Página', plural: 'Páginas', Icon: PanelsTopLeft },
  curso: { label: 'Curso', plural: 'Cursos', Icon: GraduationCap },
  aula: { label: 'Aula', plural: 'Aulas', Icon: BookOpen },
  infoproduto: { label: 'Infoproduto', plural: 'Infoprodutos', Icon: Package },
  youtube: { label: 'YouTube', plural: 'YouTube', Icon: Clapperboard },
}

/** Pequeno detalhe de cor por tipo (os demais usam a cor do conjunto). A identidade SquadHub continua predominante. */
export const TYPE_ACCENT: Partial<Record<ContentType, string>> = {
  infoproduto: '#3ec8f5',
  youtube: '#ff8f8f',
}

/**
 * Composição do cartão. Tipos novos reaproveitam o desenho dos existentes (curso = peso maior, criativo = miniatura em
 * destaque, aula = compacto), sem redesenhar os cards.
 */
export const LAYOUT_KIND: Record<ContentType, 'curso' | 'pagina' | 'criativo' | 'aula'> = {
  criativo: 'criativo',
  pagina: 'pagina',
  curso: 'curso',
  aula: 'aula',
  infoproduto: 'curso',
  youtube: 'criativo',
}

/** Tipos oferecidos no formulário de criação (muda conforme a fonte de dados). */
export let SELECTABLE_TYPES: ContentType[] = ['criativo', 'pagina', 'curso', 'aula']
export function setSelectableTypes(types: ContentType[]) {
  SELECTABLE_TYPES = types
}

export const CONTENT_TYPES = Object.keys(TYPE_META) as ContentType[]

export const STATUS_META: Record<ContentStatus, { label: string }> = {
  publicado: { label: 'Publicado' },
  finalizado: { label: 'Finalizado' },
  'em-producao': { label: 'Em produção' },
}

export const CONTENT_STATUSES = Object.keys(STATUS_META) as ContentStatus[]

/** Destaque de interface (aproximação da marca; ver tokens.css). */
export const BRAND_CYAN = '#3ec8f5'

export const NEUTRAL_COLOR = '#93a4cc'

export function collectionColor(collectionId: string | null): string {
  return COLLECTIONS.find((c) => c.id === collectionId)?.color ?? NEUTRAL_COLOR
}

export function collectionName(collectionId: string | null): string {
  return COLLECTIONS.find((c) => c.id === collectionId)?.name ?? 'Sem conjunto'
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
