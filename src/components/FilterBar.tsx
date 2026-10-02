import { useEffect, useRef, useState } from 'react'
import { Focus, FilterX, SlidersHorizontal, X } from 'lucide-react'
import type { ContentStatus, ContentType, Filters } from '../types'
import { THEMES } from '../lib/mock'
import { hasActiveFilters } from '../lib/filters'
import { CONTENT_STATUSES, CONTENT_TYPES, STATUS_META, TYPE_META } from './meta'

interface MenuProps {
  filters: Filters
  activeCount: number
  visibleCount: number
  totalCount: number
  onChange: (next: Filters) => void
  onClear: () => void
  /** Tipos presentes nos dados (as opções do filtro). */
  types?: ContentType[]
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** Botão de filtros com popover. Fecha com Escape ou clique fora e devolve o foco ao botão. */
export function FilterMenu({ filters, activeCount, visibleCount, totalCount, onChange, onClear, types = CONTENT_TYPES }: MenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="filter-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost ${open ? 'is-active' : ''}`}
        aria-expanded={open}
        aria-controls="filtros"
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span className="btn-label">Filtros</span>
        {activeCount > 0 && <span className="badge">{activeCount}</span>}
      </button>

      {open && (
        <section id="filtros" className="popover filters-popover" aria-label="Filtros">
          <div className="filter-group" role="group" aria-label="Tipo de conteúdo">
            <span className="filter-title">Tipo</span>
            <div className="chip-row">
              {types.map((type: ContentType) => (
                <button
                  key={type}
                  type="button"
                  className="chip"
                  aria-pressed={filters.types.includes(type)}
                  onClick={() => onChange({ ...filters, types: toggle(filters.types, type) })}
                >
                  {TYPE_META[type].plural}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group" role="group" aria-label="Tema">
            <span className="filter-title">Tema</span>
            <div className="chip-row">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="chip"
                  aria-pressed={filters.themes.includes(theme.id)}
                  onClick={() => onChange({ ...filters, themes: toggle(filters.themes, theme.id) })}
                >
                  {theme.label}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group" role="group" aria-label="Status">
            <span className="filter-title">Status</span>
            <div className="chip-row">
              {CONTENT_STATUSES.map((status: ContentStatus) => (
                <button
                  key={status}
                  type="button"
                  className="chip"
                  aria-pressed={filters.statuses.includes(status)}
                  onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, status) })}
                >
                  <span className={`status-dot status-${status}`} aria-hidden="true" />
                  {STATUS_META[status].label}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-footer">
            <span className="result-count" role="status">
              {visibleCount} de {totalCount} {totalCount === 1 ? 'conteúdo' : 'conteúdos'}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} disabled={!hasActiveFilters(filters)}>
              <FilterX size={14} aria-hidden="true" />
              Limpar filtros
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

interface SummaryProps {
  filters: Filters
  visibleCount: number
  totalCount: number
  onChange: (next: Filters) => void
  onClear: () => void
  /** Enquadra a câmera nos resultados. */
  onFrame: () => void
}

/** Resumo compacto das seleções ativas, sobre o canvas. */
export function ActiveFilters({ filters, visibleCount, totalCount, onChange, onClear, onFrame }: SummaryProps) {
  if (!hasActiveFilters(filters)) return null
  const items: { key: string; label: string; remove: () => void }[] = [
    ...filters.types.map((t) => ({ key: `t-${t}`, label: TYPE_META[t].plural, remove: () => onChange({ ...filters, types: filters.types.filter((x) => x !== t) }) })),
    ...filters.themes.map((t) => ({
      key: `h-${t}`,
      label: THEMES.find((x) => x.id === t)?.label ?? t,
      remove: () => onChange({ ...filters, themes: filters.themes.filter((x) => x !== t) }),
    })),
    ...filters.statuses.map((s) => ({ key: `s-${s}`, label: STATUS_META[s].label, remove: () => onChange({ ...filters, statuses: filters.statuses.filter((x) => x !== s) }) })),
  ]
  if (filters.query.trim()) {
    items.unshift({ key: 'q', label: `“${filters.query.trim()}”`, remove: () => onChange({ ...filters, query: '' }) })
  }
  return (
    <div className="active-filters" role="group" aria-label="Filtros ativos">
      <span className="result-count">
        {visibleCount} de {totalCount}
      </span>
      {items.map((item) => (
        <span key={item.key} className="chip-active">
          {item.label}
          <button type="button" aria-label={`Remover filtro: ${item.label}`} onClick={item.remove}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      {visibleCount > 0 && (
        <button type="button" className="link-btn link-btn-icon" onClick={onFrame}>
          <Focus size={13} aria-hidden="true" />
          Enquadrar resultados
        </button>
      )}
      <button type="button" className="link-btn" onClick={onClear}>
        Limpar
      </button>
    </div>
  )
}
