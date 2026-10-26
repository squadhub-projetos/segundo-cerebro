import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp, Link2, Loader2, Maximize, RefreshCcw, Sparkles, X } from 'lucide-react'
import type { ProposedPlan } from '../../types/assistant'
import type { UiMessage } from '../../state/useAssistant'

interface Props {
  open: boolean
  brainName: string
  messages: UiMessage[]
  sending: boolean
  /** `null`: ainda verificando; `false`: a OpenAI não está configurada neste ambiente. */
  enabled: boolean | null
  onClose: () => void
  onSend: (text: string) => void
  onConfirm: (messageId: string) => void
  onCancel: (messageId: string) => void
  onAdjust: (messageId: string) => void
  /** Navega ao mapa, seleciona e enquadra os itens. */
  onViewOnMap: (ids: string[]) => void
  onFrame: (ids: string[]) => void
}

const PLACEHOLDER = 'Descreva uma ideia, conteúdo ou estrutura que você quer adicionar...'

function PlanCard({ plan, state, onConfirm, onCancel, onAdjust }: { plan: ProposedPlan; state: UiMessage['planState']; onConfirm: () => void; onCancel: () => void; onAdjust: () => void }) {
  const [details, setDetails] = useState(false)
  const { view } = plan
  const active = state === 'pending' || state === 'executing'
  return (
    <div className={`plan-card ${state === 'superseded' || state === 'cancelled' ? 'is-muted' : ''}`}>
      <p className="plan-card-title">Plano</p>
      <ul className="plan-counts">
        {view.creates.map((c) => (
          <li key={c.typeLabel}>
            <span>{c.count === 1 ? `Novo item: ${c.typeLabel}` : `Novos itens: ${c.typePlural}`}</span>
            <strong>{c.count}</strong>
          </li>
        ))}
        {view.reuses > 0 && (
          <li>
            <span>{view.reuses === 1 ? 'Conteúdo reaproveitado' : 'Conteúdos reaproveitados'}</span>
            <strong>{view.reuses}</strong>
          </li>
        )}
        <li>
          <span>{view.connections === 1 ? 'Conexão' : 'Conexões'}</span>
          <strong>{view.connections}</strong>
        </li>
      </ul>
      <button type="button" className="plan-details-toggle" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
        {details ? 'Ocultar detalhes' : 'Ver detalhes'}
      </button>
      {details && (
        <ul className="plan-lines">
          {view.lines.map((l, i) => (
            <li key={i} className={`is-${l.kind}`}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      {plan.warnings.length > 0 && (
        <ul className="plan-warnings">
          {plan.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {active ? (
        <div className="plan-actions">
          <button type="button" className="btn btn-primary" disabled={state === 'executing'} onClick={onConfirm}>
            {state === 'executing' ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
            {state === 'executing' ? 'Criando…' : 'Criar agora'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={state === 'executing'} onClick={onAdjust}>
            Ajustar
          </button>
          <button type="button" className="btn btn-quiet" disabled={state === 'executing'} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      ) : (
        <p className="plan-status">{state === 'done' ? 'Plano executado.' : state === 'cancelled' ? 'Plano cancelado.' : 'Substituído por um plano mais novo.'}</p>
      )}
    </div>
  )
}

/** Chat lateral (direita). Fechado, não ocupa espaço; aberto, divide a área com o mapa. */
export function AssistantPanel({ open, brainName, messages, sending, enabled, onClose, onSend, onConfirm, onCancel, onAdjust, onViewOnMap, onFrame }: Props) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending, open])

  // Foco no campo ao abrir.
  useEffect(() => {
    if (open && enabled !== false) window.setTimeout(() => inputRef.current?.focus(), 260)
  }, [open, enabled])

  // Campo expansível (até ~6 linhas).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [text])

  const submit = () => {
    if (!text.trim() || sending || enabled === false) return
    onSend(text)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <aside className={`assistant ${open ? 'is-open' : ''}`} aria-label="Assistente" aria-hidden={!open} inert={!open}>
      <div className="assistant-inner">
        <header className="assistant-head">
          <span className="assistant-title">
            <Sparkles size={16} aria-hidden="true" />
            Assistente · {brainName}
          </span>
          <button type="button" className="icon-btn" aria-label="Fechar assistente" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="assistant-list" ref={listRef} role="log" aria-live="polite">
          {messages.length === 0 && (
            <div className="assistant-hello">
              <p>Posso ajudar a registrar conteúdos e conectá-los no cérebro de {brainName}.</p>
              <p className="assistant-hint">Tente: "Crie um curso chamado Gestão com IA com duas aulas: priorização e acompanhamento semanal."</p>
              <p className="assistant-hint">Eu sempre mostro o plano e só crio depois da sua confirmação.</p>
            </div>
          )}
          {enabled === false && <p className="assistant-notice">O assistente não está configurado neste ambiente. O resto do Segundo Cérebro continua funcionando.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`msg is-${m.role} ${m.failed ? 'is-error' : ''}`}>
              <div className="msg-bubble">{m.text}</div>
              {m.plan && m.planState && (
                <PlanCard plan={m.plan} state={m.planState} onConfirm={() => onConfirm(m.id)} onCancel={() => onCancel(m.id)} onAdjust={() => { onAdjust(m.id); inputRef.current?.focus() }} />
              )}
              {m.result && (
                <div className="result-actions">
                  {(() => {
                    const ids = m.result.createdIds.length ? m.result.createdIds : m.result.reusedIds
                    return (
                      <>
                        <button type="button" className="btn btn-ghost" disabled={!m.result.ready || ids.length === 0} onClick={() => onViewOnMap(ids)}>
                          {m.result.ready ? <Link2 size={14} aria-hidden="true" /> : <RefreshCcw size={14} className="spin" aria-hidden="true" />}
                          Ver no mapa
                        </button>
                        <button type="button" className="btn btn-ghost" disabled={!m.result.ready || ids.length === 0} onClick={() => onFrame(ids)}>
                          <Maximize size={14} aria-hidden="true" />
                          Enquadrar itens criados
                        </button>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="msg is-assistant">
              <div className="msg-bubble is-typing" aria-label="O assistente está analisando">
                <span /> <span /> <span />
              </div>
            </div>
          )}
        </div>

        <form
          className="assistant-input"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={PLACEHOLDER}
            aria-label="Mensagem para o assistente"
            disabled={enabled === false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="submit" className="send-btn" aria-label="Enviar" disabled={!text.trim() || sending || enabled === false}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  )
}
