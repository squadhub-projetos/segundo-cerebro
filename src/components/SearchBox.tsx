import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import type { Content } from '../types'
import type { MatchInfo } from '../lib/search'
import { Highlight } from './Highlight'
import { IconButton } from './IconButton'
import { TYPE_META } from './meta'

interface Props {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  inputRef: RefObject<HTMLInputElement | null>
  /** Resultados lógicos (após debounce). */
  results: Content[]
  info: Map<string, MatchInfo>
  /** Há consulta de texto aplicada. */
  searching: boolean
  onPick: (id: string) => void
  /** Realça o nó correspondente no mapa enquanto o mouse/foco está num resultado. */
  onPreview: (id: string | null) => void
}

const MAX_LISTED = 40

/**
 * Pesquisa dentro do mapa: os resultados aparecem no grafo. A lista detalhada é opcional e recolhida,
 * aberta pelo chevron à direita do campo.
 */
export function SearchBox({ value, onChange, onClear, inputRef, results, info, searching, onPick, onPreview }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [listOpen, setListOpen] = useState(false)

  const canList = searching && results.length > 0
  const open = listOpen && canList

  // Fecha ao clicar fora; ao fechar, remove o realce de prévia.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setListOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      onPreview(null)
    }
  }, [open, onPreview])

  const items = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && canList) {
      e.preventDefault()
      if (!open) setListOpen(true)
      requestAnimationFrame(() => items()[0]?.focus())
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setListOpen(false)
    }
  }

  const onItemKey = (e: KeyboardEvent, index: number) => {
    const list = items()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      list[Math.min(index + 1, list.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (index === 0) inputRef.current?.focus()
      else list[index - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setListOpen(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="search-wrap" ref={wrapRef}>
      <div className="search" role="search">
        <label htmlFor="busca" className="sr-only">
          Buscar conteúdos
        </label>
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          id="busca"
          ref={inputRef}
          type="text"
          value={value}
          placeholder="Buscar por título, descrição ou tema"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onInputKey}
        />
        {value && (
          <IconButton label="Limpar pesquisa" className="search-clear" onClick={onClear}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        )}
        {canList && (
          <IconButton
            label={open ? 'Ocultar lista de resultados' : 'Ver lista de resultados'}
            className={`search-toggle ${open ? 'is-open' : ''}`}
            aria-expanded={open}
            aria-controls="lista-resultados"
            onClick={() => setListOpen((v) => !v)}
          >
            {/* A chave faz o chevron "acenar" uma vez quando o conjunto de resultados muda. */}
            <ChevronDown key={results.length} size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>

      {open && (
        <ul id="lista-resultados" className="search-results popover" ref={listRef} aria-label="Resultados da pesquisa">
          {results.slice(0, MAX_LISTED).map((content, index) => {
            const match = info.get(content.id)
            const { Icon, label } = TYPE_META[content.type]
            return (
              <li key={content.id}>
                <button
                  type="button"
                  className="search-result"
                  onClick={() => {
                    setListOpen(false)
                    onPick(content.id)
                  }}
                  onMouseEnter={() => onPreview(content.id)}
                  onMouseLeave={() => onPreview(null)}
                  onFocus={() => onPreview(content.id)}
                  onBlur={() => onPreview(null)}
                  onKeyDown={(e) => onItemKey(e, index)}
                >
                  <span className="search-result-title">
                    <Highlight text={content.title} ranges={match?.titleRanges} />
                  </span>
                  <span className="search-result-meta">
                    <Icon size={12} aria-hidden="true" />
                    {label}
                    {match?.extra && (
                      <span className="reason">
                        <span className="reason-k">{match.extra.kind === 'theme' ? 'Tema' : match.extra.kind === 'meta' ? match.extra.label : 'Descrição'}:</span>{' '}
                        <Highlight text={match.extra.text} ranges={match.extra.ranges} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
          {results.length > MAX_LISTED && <li className="search-more">+{results.length - MAX_LISTED} resultados no grafo</li>}
        </ul>
      )}
    </div>
  )
}
