import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { BrainConfig } from '../../brains/types'

interface Props {
  brains: readonly BrainConfig[]
  activeId: string
  /** Barra lateral recolhida: só o ícone; a lista abre ao lado. */
  collapsed: boolean
  onSelect: (id: string) => void
}

/** Seletor de cérebro (componente próprio, sem <select> nativo). Cérebros desabilitados aparecem como "Em breve". */
export function BrainSelector({ brains, activeId, collapsed, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = brains.find((b) => b.id === activeId) ?? brains[0]
  const ActiveIcon = active.Icon

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        rootRef.current?.querySelector<HTMLButtonElement>('.brain-trigger')?.focus()
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
    <div className="brain-selector" ref={rootRef}>
      <button
        type="button"
        className={`brain-trigger ${collapsed ? 'tip-side' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Cérebro atual: ${active.name}. Trocar de cérebro`}
        data-tip={collapsed && !open ? `Cérebro: ${active.name}` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="brain-trigger-icon">
          <ActiveIcon size={18} aria-hidden="true" />
        </span>
        <span className="sb-label brain-trigger-text">
          <span className="brain-trigger-kicker">Segundo Cérebro</span>
          <span className="brain-trigger-name">{active.name}</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" className={`sb-label brain-trigger-chevron ${open ? 'is-open' : ''}`} />
      </button>

      {open && (
        <div className={`brain-list popover ${collapsed ? 'is-side' : ''}`} role="listbox" aria-label="Cérebros">
          <p className="brain-list-title">Segundo Cérebro</p>
          {brains.map((brain) => {
            const Icon = brain.Icon
            const selected = brain.id === activeId
            return (
              <button
                key={brain.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={!brain.enabled}
                className={`brain-option ${selected ? 'is-selected' : ''} ${brain.enabled ? '' : 'is-soon'}`}
                onClick={() => {
                  if (!brain.enabled) return
                  onSelect(brain.id)
                  setOpen(false)
                }}
              >
                <span className="brain-option-icon">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className="brain-option-text">
                  <span className="brain-option-name">{brain.name}</span>
                  <span className="brain-option-desc">{brain.tagline}</span>
                </span>
                {selected && <Check size={16} aria-hidden="true" className="brain-option-check" />}
                {!brain.enabled && <span className="brain-soon">Em breve</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
