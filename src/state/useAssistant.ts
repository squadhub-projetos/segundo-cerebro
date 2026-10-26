import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExecuteResponse, ProposedPlan } from '../types/assistant'
import { aiApi } from '../data/providers/aiApi'

/**
 * Conversa com o assistente. O histórico vive no navegador (só nesta sessão) e é SEPARADO POR CÉREBRO: trocar de cérebro troca
 * a conversa e o schema usado. Nada é executado ao conversar: o plano só roda depois de `confirm`.
 */

export type PlanState = 'pending' | 'executing' | 'done' | 'cancelled' | 'superseded'

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  plan?: ProposedPlan
  planState?: PlanState
  /** Resultado de uma execução. `ready`: o mapa já foi atualizado com os itens criados. */
  result?: ExecuteResponse & { ready: boolean }
  failed?: boolean
}

const UNAVAILABLE = 'O assistente não conseguiu analisar sua solicitação agora.'
let counter = 0
const uid = () => `m${Date.now().toString(36)}${counter++}`

interface Options {
  /** Atualiza o mapa depois de uma execução (recarrega os dados). */
  onExecuted: () => Promise<boolean>
}

export function useAssistant(brainId: string, { onExecuted }: Options) {
  const [histories, setHistories] = useState<Record<string, UiMessage[]>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const historiesRef = useRef(histories)
  const onExecutedRef = useRef(onExecuted)

  useEffect(() => {
    historiesRef.current = histories
    onExecutedRef.current = onExecuted
  })

  /** Verifica (uma vez) se o servidor tem a OpenAI configurada. O resto do app funciona sem ela. */
  const checkStatus = useCallback(() => {
    aiApi
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false))
  }, [])

  const update = useCallback((brain: string, fn: (list: UiMessage[]) => UiMessage[]) => {
    setHistories((h) => {
      const next = { ...h, [brain]: fn(h[brain] ?? []) }
      historiesRef.current = next
      return next
    })
  }, [])

  const patch = useCallback(
    (brain: string, id: string, p: Partial<UiMessage>) => update(brain, (list) => list.map((m) => (m.id === id ? { ...m, ...p } : m))),
    [update],
  )

  const send = useCallback(
    async (text: string) => {
      const brain = brainId
      const clean = text.trim()
      if (!clean || sending[brain]) return
      const before = historiesRef.current[brain] ?? []
      const active = [...before].reverse().find((m) => m.plan && m.planState === 'pending')
      const userMsg: UiMessage = { id: uid(), role: 'user', text: clean }
      update(brain, (l) => [...l, userMsg])
      setSending((s) => ({ ...s, [brain]: true }))
      try {
        const turns = [...before, userMsg].filter((m) => !m.failed).map((m) => ({ role: m.role, content: m.text }))
        const answer = await aiApi.chat(brain, turns.slice(-16), active?.plan ? { brainId: brain, actions: active.plan.actions, warnings: [] } : null)
        const reply: UiMessage = { id: uid(), role: 'assistant', text: answer.message, plan: answer.plan ?? undefined, planState: answer.plan ? 'pending' : undefined }
        // Um plano novo substitui o anterior ainda pendente.
        update(brain, (l) => [...(answer.plan ? l.map((m) => (m.planState === 'pending' ? { ...m, planState: 'superseded' as const } : m)) : l), reply])
      } catch (error) {
        const code = (error as { code?: string }).code
        const text = code === 'ai_not_configured' ? 'O assistente não está configurado neste ambiente.' : code === 'rate_limited' ? 'Muitas solicitações em pouco tempo. Aguarde um instante.' : UNAVAILABLE
        update(brain, (l) => [...l, { id: uid(), role: 'assistant', text, failed: true }])
      } finally {
        setSending((s) => ({ ...s, [brain]: false }))
      }
    },
    [brainId, sending, update],
  )

  const confirm = useCallback(
    async (messageId: string) => {
      const brain = brainId
      const msg = (historiesRef.current[brain] ?? []).find((m) => m.id === messageId)
      if (!msg?.plan || msg.planState !== 'pending') return
      patch(brain, messageId, { planState: 'executing' })
      try {
        const result = await aiApi.execute(brain, msg.plan.actions)
        patch(brain, messageId, { planState: 'done' })
        const resultId = uid()
        update(brain, (l) => [...l, { id: resultId, role: 'assistant', text: result.message, result: { ...result, ready: false } }])
        const ok = await onExecutedRef.current()
        patch(brain, resultId, { result: { ...result, ready: ok } })
      } catch (error) {
        const detail = (error as { message?: string }).message
        patch(brain, messageId, { planState: 'pending' })
        update(brain, (l) => [...l, { id: uid(), role: 'assistant', text: `Não foi possível executar o plano agora${detail ? `: ${detail}` : ''}. Nada foi alterado além do que já aparece no mapa; você pode tentar de novo.`, failed: true }])
      }
    },
    [brainId, patch, update],
  )

  const cancel = useCallback(
    (messageId: string) => {
      patch(brainId, messageId, { planState: 'cancelled' })
      update(brainId, (l) => [...l, { id: uid(), role: 'assistant', text: 'Tudo bem, não criei nada.' }])
    },
    [brainId, patch, update],
  )

  /** "Ajustar": o plano continua pendente e o usuário descreve a mudança na próxima mensagem. */
  const adjust = useCallback(
    (messageId: string) => {
      void messageId
      update(brainId, (l) => [...l, { id: uid(), role: 'assistant', text: 'Claro. O que você quer mudar no plano?' }])
    },
    [brainId, update],
  )

  return { messages: histories[brainId] ?? [], sending: Boolean(sending[brainId]), enabled, checkStatus, send, confirm, cancel, adjust }
}
