import { ChevronsLeft, ChevronsRight, Network, Plus, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BrainConfig, ViewId } from '../../brains/types'
import { BrainSelector } from '../brain-selector/BrainSelector'

interface Props {
  brain: BrainConfig
  brains: readonly BrainConfig[]
  view: ViewId
  collapsed: boolean
  onToggle: () => void
  onView: (view: ViewId) => void
  onNew: () => void
  onSelectBrain: (id: string) => void
}

interface Item {
  key: string
  label: string
  Icon: LucideIcon
  /** Tela que o item abre; ausente = ação. */
  view?: ViewId
  onClick: () => void
}

/**
 * Menu lateral do cérebro ativo. Os textos vêm da configuração do cérebro; a mesma barra serve a qualquer cérebro.
 * Recolhida (64 px) mostra só ícones com tooltip; expandida (240 px) mostra os rótulos.
 */
export function BrainSidebar({ brain, brains, view, collapsed, onToggle, onView, onNew, onSelectBrain }: Props) {
  const items: Item[] = [
    { key: 'map', label: 'Mapa', Icon: Network, view: 'map', onClick: () => onView('map') },
    { key: 'new', label: brain.labels.newItem, Icon: Plus, onClick: onNew },
    { key: 'connections', label: 'Conexões', Icon: Workflow, view: 'connections', onClick: () => onView('connections') },
  ]

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Menu do cérebro">
      <BrainSelector brains={brains} activeId={brain.id} collapsed={collapsed} onSelect={onSelectBrain} />

      <nav className="sb-nav" aria-label={`Navegação: ${brain.name}`}>
        {items.map(({ key, label, Icon, view: target, onClick }) => (
          <button
            key={key}
            type="button"
            className={`sb-item tip-side ${target && view === target ? 'is-active' : ''}`}
            aria-current={target && view === target ? 'page' : undefined}
            aria-label={label}
            data-tip={collapsed ? label : undefined}
            onClick={onClick}
          >
            <span className="sb-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="sb-label">{label}</span>
          </button>
        ))}
      </nav>

      <button
        type="button"
        className="sb-item sb-toggle tip-side"
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        aria-expanded={!collapsed}
        data-tip={collapsed ? 'Expandir menu' : undefined}
        onClick={onToggle}
      >
        <span className="sb-icon">{collapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}</span>
        <span className="sb-label">Recolher menu</span>
      </button>
    </aside>
  )
}
