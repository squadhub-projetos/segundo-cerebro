import { SearchX } from 'lucide-react'
import type { Filters } from '../types'
import { THEMES } from '../lib/mock'
import { STATUS_META, TYPE_META } from './meta'

interface Props {
  query: string
  filters: Filters
  onClearSearch: () => void
  onClearFilters: () => void
}

/** Estado vazio: aparece depois que os cards terminam de sair (atraso no CSS). */
export function EmptyResults({ query, filters, onClearSearch, onClearFilters }: Props) {
  const others = [
    ...filters.types.map((t) => TYPE_META[t].plural),
    ...filters.themes.map((t) => THEMES.find((x) => x.id === t)?.label ?? t),
    ...filters.statuses.map((s) => STATUS_META[s].label),
  ]
  return (
    <div className="empty-state" role="status">
      <SearchX size={26} aria-hidden="true" />
      <h2>Nenhum conteúdo encontrado</h2>
      {query && (
        <p>
          Pesquisa: <strong>“{query}”</strong>
        </p>
      )}
      {others.length > 0 && <p>Filtros ativos: {others.join(', ')}</p>}
      <div className="empty-actions">
        {query && (
          <button type="button" className="btn btn-primary" onClick={onClearSearch}>
            Limpar pesquisa
          </button>
        )}
        {others.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={onClearFilters}>
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  )
}
