import type { Content, Theme } from '../../types'
import { ProviderError } from './errors'

/**
 * Escrita na monday via /api/mutate (o servidor guarda o token e valida cada operação). Cada chamada só retorna depois de a
 * monday confirmar; a interface atualiza o estado local somente após o sucesso.
 */

export type WritableKind = 'infoproduto' | 'aula' | 'youtube'

export interface WriteResult {
  ok: true
  content?: Content
  themes?: Theme[]
  deleted?: string
  warning?: string
}

async function post(body: Record<string, unknown>): Promise<WriteResult> {
  let response: Response
  try {
    response = await fetch('/api/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ProviderError('network', 'Sem conexão com o servidor do Segundo Cérebro.')
  }
  const data = (await response.json().catch(() => null)) as (WriteResult & { error?: string; message?: string }) | null
  if (!response.ok || !data || data.error) {
    throw new ProviderError(data?.error ?? `http_${response.status}`, data?.message ?? `O servidor respondeu ${response.status}.`)
  }
  return data
}

export const mondayWriter = {
  create: (type: WritableKind, title: string, description: string | undefined, links: { type: WritableKind; itemId: string }[]) =>
    post({ op: 'create', type, title, description, links }),
  update: (type: WritableKind, itemId: string, fields: { title?: string; description?: string }) =>
    post({ op: 'update', type, itemId, ...fields }),
  remove: (type: WritableKind, itemId: string) => post({ op: 'delete', type, itemId }),
  duplicate: (type: WritableKind, itemId: string) => post({ op: 'duplicate', type, itemId }),
  link: (childType: 'aula' | 'youtube', childItemId: string, infoItemId: string) =>
    post({ op: 'link', childType, childItemId, infoItemId }),
  unlink: (childType: 'aula' | 'youtube', childItemId: string, infoItemId: string) =>
    post({ op: 'unlink', childType, childItemId, infoItemId }),
}
