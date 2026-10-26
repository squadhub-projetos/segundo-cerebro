import type { Content, Theme } from '../../types'
import { ProviderError, httpError } from './errors'

/**
 * Escrita de itens na monday via /api/mutate (o servidor guarda o token e valida cada operação). Cada chamada só retorna
 * depois de a monday confirmar; a interface atualiza o estado local somente após o sucesso. Tipos e conexões são identificados
 * pelo slug do schema (nada de nomes fixos).
 */

export interface WriteResult {
  ok: true
  content?: Content
  themes?: Theme[]
  deleted?: string
  warning?: string
}

/** Vínculo inicial de um item recém-criado. `role` é o papel do NOVO item na conexão. */
export interface InitialLink {
  connection: string
  itemId: string
  role: 'source' | 'target'
}

async function post(body: Record<string, unknown>): Promise<WriteResult> {
  let response: Response
  try {
    response = await fetch('/api/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    console.error('[SecondBrain] POST /api/mutate falhou antes de receber resposta:', error)
    throw new ProviderError('network', 'Sem conexão com o servidor do Segundo Cérebro.')
  }
  const data = (await response.json().catch(() => null)) as (WriteResult & { error?: string; message?: string }) | null
  if (!response.ok || !data || data.error) {
    throw httpError('/api/mutate', response.status, data?.error, data?.message)
  }
  return data
}

export const mondayWriter = {
  create: (type: string, title: string, description: string | undefined, links: InitialLink[]) =>
    post({ op: 'create', type, title, description, links }),
  update: (type: string, itemId: string, fields: { title?: string; description?: string }) =>
    post({ op: 'update', type, itemId, ...fields }),
  remove: (type: string, itemId: string) => post({ op: 'delete', type, itemId }),
  duplicate: (type: string, itemId: string) => post({ op: 'duplicate', type, itemId }),
  link: (connection: string, sourceItemId: string, targetItemId: string) =>
    post({ op: 'link', connection, sourceItemId, targetItemId }),
  unlink: (connection: string, sourceItemId: string, targetItemId: string) =>
    post({ op: 'unlink', connection, sourceItemId, targetItemId }),
}
