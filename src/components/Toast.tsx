/** Aviso curto e discreto (conexão criada, removida, inválida...). Anunciado a leitores de tela. */
export function Toast({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
      {action && (
        <button type="button" className="toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
