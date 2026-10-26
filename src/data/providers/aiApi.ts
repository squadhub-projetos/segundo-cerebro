import type { ActionPlan, ChatResponse, ChatTurn, ExecuteResponse, PlanAction } from '../../types/assistant'
import { ProviderError } from './errors'

/**
 * Cliente do assistente. Só fala com /api/ai/* (o servidor guarda a OPENAI_API_KEY e o token da monday). O navegador envia a
 * conversa e, depois da confirmação, o plano; o servidor revalida tudo.
 */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', ...init })
  } catch {
    throw new ProviderError('network', 'Sem conexão com o servidor do Segundo Cérebro.')
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null
  if (!response.ok || !data || ('error' in data && data.error)) {
    throw new ProviderError(data?.error ?? `http_${response.status}`, data?.message ?? `O servidor respondeu ${response.status}.`)
  }
  return data
}

export const aiApi = {
  status: () => call<{ enabled: boolean; model: string | null }>('/api/ai/chat'),
  chat: (brainId: string, messages: ChatTurn[], currentPlan: ActionPlan | null) =>
    call<ChatResponse>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ brainId, messages, currentPlan }) }),
  execute: (brainId: string, actions: PlanAction[]) =>
    call<ExecuteResponse>('/api/ai/execute', { method: 'POST', body: JSON.stringify({ brainId, actions }) }),
}
