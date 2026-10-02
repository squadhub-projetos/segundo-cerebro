import type { Content, Filters, Theme } from '../types'
import { matchContent, queryTerms } from './search'
import type { MatchInfo } from './search'

export const EMPTY_FILTERS: Filters = { query: '', types: [], themes: [], statuses: [] }

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.query.trim()) || f.types.length > 0 || f.themes.length > 0 || f.statuses.length > 0
}

export function countActiveFilters(f: Filters): number {
  return (f.types.length ? 1 : 0) + (f.themes.length ? 1 : 0) + (f.statuses.length ? 1 : 0)
}

export interface FilterResult {
  contents: Content[]
  /** Motivo da correspondência por ID; vazio quando não há consulta de texto. */
  info: Map<string, MatchInfo>
}

/** Busca por título, descrição e nomes legíveis dos temas, combinada com os filtros (E entre grupos, OU dentro). */
export function filterContents(contents: Content[], filters: Filters, themes: Theme[]): FilterResult {
  const terms = queryTerms(filters.query)
  const info = new Map<string, MatchInfo>()
  const result = contents.filter((c) => {
    if (filters.types.length && !filters.types.includes(c.type)) return false
    if (filters.statuses.length && !filters.statuses.includes(c.status)) return false
    if (filters.themes.length && !c.themes.some((t) => filters.themes.includes(t))) return false
    if (terms.length === 0) return true
    const match = matchContent(c, terms, themes)
    if (!match) return false
    info.set(c.id, match)
    return true
  })
  return { contents: result, info }
}
