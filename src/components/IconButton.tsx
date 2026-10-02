import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Nome acessível e texto do tooltip. */
  label: string
  children: ReactNode
  tipSide?: 'top' | 'bottom'
}

/** Botão de ícone com nome acessível e tooltip (hover e foco por teclado). */
export function IconButton({ label, children, tipSide = 'bottom', className = '', type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={`icon-btn tip tip-${tipSide} ${className}`} aria-label={label} data-tip={label} {...rest}>
      {children}
    </button>
  )
}
