import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface MenuItem {
  key: string
  label: string
  icon: ReactNode
  /** Dica à direita (por exemplo, atalho). */
  hint?: string
  danger?: boolean
}

interface Props {
  /** Posição do cursor na janela (px). */
  x: number
  y: number
  /** Cabeçalho opcional (por exemplo, "3 selecionados"). */
  title?: string
  items: MenuItem[]
  /** Chamado com a chave do item escolhido (depois de fechar o menu). */
  onAction: (key: string) => void
  onClose: () => void
}

const EDGE = 8

/**
 * Menu contextual da aplicação. Abre junto ao cursor e inverte o lado perto das bordas da janela. Fecha com Escape,
 * clique fora, rolagem/zoom (roda) ou ao escolher uma ação. Navegação por setas.
 */
export function ContextMenu({ x, y, title, items, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)

  // Mede o menu e escolhe o lado que cabe na janela.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const flipX = x + w + EDGE > window.innerWidth
    const flipY = y + h + EDGE > window.innerHeight
    const left = Math.max(EDGE, flipX ? x - w : x)
    const top = Math.max(EDGE, flipY ? y - h : y)
    setPos({ left, top, origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}` })
  }, [x, y, items.length])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('button')
    first?.focus({ preventScroll: true })
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onClose, { passive: true, capture: true })
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onClose, { capture: true })
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={title ?? 'Menu de contexto'}
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, transformOrigin: pos?.origin, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && <div className="ctx-title">{title}</div>}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`ctx-item ${item.danger ? 'is-danger' : ''}`}
          onClick={() => {
            onClose()
            onAction(item.key)
          }}
        >
          <span className="ctx-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="ctx-label">{item.label}</span>
          {item.hint && <span className="ctx-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}
