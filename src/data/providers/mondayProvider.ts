import type { GraphPayload } from '../../types'
import { ProviderError } from './errors'

/**
 * Lê o grafo da API do próprio app (/api/graph), que consulta a monday no servidor. O navegador nunca vê o token nem fala
 * diretamente com a monday. Somente leitura.
 */
export async function loadMondayGraph(refresh: boolean): Promise<GraphPayload> {
  let response: Response
  try {
    response = await fetch(`/api/graph${refresh ? '?refresh=1' : ''}`, { headers: { Accept: 'application/json' } })
  } catch {
    throw new ProviderError('network', 'Sem conexão com o servidor do Segundo Cérebro.')
  }
  const body = (await response.json().catch(() => null)) as (GraphPayload & { error?: string; message?: string }) | null
  if (!response.ok || !body || body.error) {
    throw new ProviderError(body?.error ?? `http_${response.status}`, body?.message ?? `O servidor respondeu ${response.status}.`)
  }
  return body
}
