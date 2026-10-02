import type { ReactNode } from 'react'
import { Modal } from './Modal'

interface Props {
  title: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}

export function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }: Props) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} data-autofocus>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
