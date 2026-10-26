import type { Cardinality, ConnectionNature } from '../../types/schema'
import { ProviderError, StructureError } from './errors'

/**
 * Alterações do schema (criar tipo de conteúdo / tipo de conexão) via /api/structure. O servidor é a autoridade: valida,
 * aplica a proteção (habilitação + chave de administração) e fala com a monday. A chave, quando exigida, fica só na sessão do
 * navegador (sessionStorage) e é enviada no cabeçalho; nunca é persistida.
 */

const KEY = 'squadhub:segundo-cerebro:adminKey'

export const adminKey = {
  get(): string {
    try {
      return sessionStorage.getItem(KEY) ?? ''
    } catch {
      return ''
    }
  },
  set(value: string) {
    try {
      if (value) sessionStorage.setItem(KEY, value)
      else sessionStorage.removeItem(KEY)
    } catch {
      /* sem armazenamento de sessão: a chave vale só nesta chamada */
    }
  },
}

export interface NodeTypeInput {
  name: string
  plural: string
  description: string
  brainId: string
  icon: string
}

export interface ConnectionInput {
  brainId: string
  source: string
  target: string
  label: string
  reverseLabel: string
  nature: ConnectionNature
  cardinality: Cardinality
}

export interface NodeTypePlan {
  brainName: string
  boardName: string
  workspace: { id: string; name: string } | null
  folder: { id: string; name: string } | null
  columns: string[]
  initializesRegistry: boolean
}

export interface ConnectionPlan {
  sourceName: string
  targetName: string
  boardName: string
  columnTitle: string
  multiple: boolean
  sameBoard: boolean
  reflection: boolean
}

async function post<T>(body: Record<string, unknown>, key?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const sent = key ?? adminKey.get()
  if (sent) headers['x-admin-key'] = sent
  let response: Response
  try {
    response = await fetch('/api/structure', { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (error) {
    console.error('[SecondBrain] POST /api/structure falhou antes de receber resposta:', error)
    throw new ProviderError('network', 'Sem conexão com o servidor do Segundo Cérebro.')
  }
  const data = (await response.json().catch(() => null)) as ({ error?: string; message?: string; details?: StructureError['details'] } & T) | null
  if (!response.ok || !data || data.error) {
    throw new StructureError(data?.error ?? `http_${response.status}`, `${data?.message ?? 'O servidor recusou a operação.'} (HTTP ${response.status})`, data?.details)
  }
  return data
}

export const schemaApi = {
  init: () => post<{ created: string[]; seededNodeTypes: number; seededConnections: number }>({ op: 'init' }),
  previewNodeType: (input: NodeTypeInput) => post<NodeTypePlan>({ op: 'preview-node-type', ...input }),
  createNodeType: (input: NodeTypeInput) => post<{ completed: string[] }>({ op: 'create-node-type', ...input }),
  previewConnection: (input: ConnectionInput) => post<ConnectionPlan>({ op: 'preview-connection', ...input }),
  createConnection: (input: ConnectionInput) => post<{ completed: string[] }>({ op: 'create-connection', ...input }),
}
