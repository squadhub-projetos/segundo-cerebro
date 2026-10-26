import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal, Plus, RefreshCw, RotateCcw, Sparkles } from 'lucide-react'
import { IconButton } from './IconButton'

interface Props {
  /** Campo de pesquisa (SearchBox). */
  searchBox: ReactNode
  /** Botão de filtros com popover. */
  filterMenu: ReactNode
  onNew: () => void
  /** Só na demonstração (mock). */
  onRestoreDemo?: () => void
  /** Só com dados live (monday). */
  onRefresh?: () => void
  refreshing?: boolean
  /** Texto do selo de origem dos dados ("Demonstração", "Dados da monday"). */
  sourceBadge: string
  /** Informação discreta no menu (por exemplo, horário da última atualização). */
  menuNote?: string
  /** Nome do cérebro ativo (mostrado ao lado do título). */
  brainName?: string
  /** Botão do assistente (chat lateral). Ausente quando não há dados live. */
  onToggleAssistant?: () => void
  assistantOpen?: boolean
}

export function TopBar({ searchBox, filterMenu, onNew, onRestoreDemo, onRefresh, refreshing, sourceBadge, menuNote, brainName, onToggleAssistant, assistantOpen }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <header className="topbar">
      <div className="brand">
        <img
          className="brand-logo"
          src={`${import.meta.env.BASE_URL}brand/logo-squadhub.svg`}
          alt="SquadHub"
          width={108}
          height={26}
        />
        <span className="brand-sep" aria-hidden="true" />
        <span className="brand-name">Segundo Cérebro</span>
        {brainName && <span className="brand-brain">· {brainName}</span>}
      </div>
      <span className="demo-badge">{sourceBadge}</span>

      {searchBox ?? <span className="topbar-spacer" />}

      <div className="topbar-actions">
        {filterMenu}
        {onToggleAssistant && (
          <IconButton label={assistantOpen ? 'Fechar assistente' : 'Abrir assistente'} aria-pressed={assistantOpen} className={assistantOpen ? 'is-active' : ''} onClick={onToggleAssistant}>
            <Sparkles size={18} aria-hidden="true" />
          </IconButton>
        )}
        <button type="button" className="btn btn-primary" onClick={onNew}>
          <Plus size={16} aria-hidden="true" />
          <span className="btn-label">Novo conteúdo</span>
        </button>
        <div className="menu" ref={menuRef}>
          <IconButton label="Mais opções" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={18} aria-hidden="true" />
          </IconButton>
          {menuOpen && (
            <div className="menu-list popover" role="menu">
              {onRefresh && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={refreshing}
                  onClick={() => {
                    setMenuOpen(false)
                    onRefresh()
                  }}
                >
                  <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'spin' : ''} />
                  {refreshing ? 'Atualizando…' : 'Atualizar dados'}
                </button>
              )}
              {onRestoreDemo && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onRestoreDemo()
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  Restaurar demonstração
                </button>
              )}
              {menuNote && <p className="menu-note">{menuNote}</p>}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
