import type { GraphPayload } from '../../types'
import { ProviderError, httpError } from './errors'

/**
 * Lê o grafo da API do próprio app (/api/graph), que consulta a monday no servidor. O navegador nunca vê o token nem fala
 * diretamente com a monday. Somente leitura.
 */
export async function loadMondayGraph(refresh: boolean): Promise<GraphPayload> {
  let response: Response
  try {
    response = await fetch(`/api/graph${refresh ? '?refresh=1' : ''}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  } catch (error) {
    console.error('[SecondBrain] GET /api/graph falhou antes de receber resposta:', error)
    throw new ProviderError('network', 'Sem conexão com o servidor do Segundo Cérebro.')
  }
  const body = (await response.json().catch(() => null)) as (GraphPayload & { error?: string; message?: string }) | null
  if (!response.ok || !body || body.error) {
    throw httpError('/api/graph', response.status, body?.error, body?.message)
  }
  return body
}
