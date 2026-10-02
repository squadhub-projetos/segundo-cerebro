/** Aviso curto e discreto (conexão criada, removida, inválida...). Anunciado a leitores de tela. */
export function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  )
}
