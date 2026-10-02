import { MondayError, fetchItem, fetchSchema, gql } from './client.js'
import { NODE_PREFIX, buildContent, relationIds, themeOf } from './normalize.js'
import type { BoardKey, MondayConfig, RawBoard, RawItem } from './types.js'
import type { Content, Theme } from '../../src/types/index.js'

/**
 * Escrita na monday (única parte do servidor que envia mutations). Só usa colunas e quadros existentes: nenhuma coluna ou
 * grupo é criado. A relação Aula/Vídeo ↔ Infoproduto é sempre gravada no lado da AULA ou do VÍDEO, lendo antes a lista atual
 * (a coluna Connect Boards é substituída por inteiro; sem ler antes, outras ligações seriam apagadas).
 */

/** Colunas reais (descobertas no schema dos quadros). */
export const COLUMNS = {
  /** Controle de Aulas → "Controle de Infoprodutos" (relação canônica). */
  lessonToInfo: 'board_relation_mm7r2dm1',
  /** Controle YouTube → "link to Controle de Infoprodutos". */
  youtubeToInfo: 'board_relation_mm7rxp0x',
  /** Descrição da aula (long text). */
  lessonDescription: 'long_text_mm7rh2ga',
} as const

export type NodeKind = 'infoproduto' | 'aula' | 'youtube'
const BOARD_OF: Record<NodeKind, BoardKey> = { infoproduto: 'infoproducts', aula: 'courses', youtube: 'youtube' }

export class RequestError extends Error {}

export type Op =
  | { op: 'create'; type: NodeKind; title: string; description?: string; links?: { type: NodeKind; itemId: string }[] }
  | { op: 'update'; type: NodeKind; itemId: string; title?: string; description?: string }
  | { op: 'delete'; type: NodeKind; itemId: string }
  | { op: 'link' | 'unlink'; childType: 'aula' | 'youtube'; childItemId: string; infoItemId: string }
  | { op: 'duplicate'; type: NodeKind; itemId: string }

export interface MutationResult {
  ok: true
  content?: Content
  themes?: Theme[]
  /** Id interno do nó removido. */
  deleted?: string
  /** Aviso não fatal (ex.: algumas colunas não puderam ser copiadas na duplicação). */
  warning?: string
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}$/.test(v)
const isKind = (v: unknown): v is NodeKind => v === 'infoproduto' || v === 'aula' || v === 'youtube'

/** Valida o corpo recebido do navegador (nunca confiamos no formato). */
export function parseOp(body: unknown): Op {
  const b = (body ?? {}) as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  switch (b.op) {
    case 'create': {
      const title = text(b.title, 255)?.trim()
      if (!isKind(b.type) || !title) throw new RequestError('Informe o tipo e o título.')
      const links = Array.isArray(b.links) ? b.links : []
      const parsed = links.map((l) => {
        const o = l as { type?: unknown; itemId?: unknown }
        if (!isKind(o.type) || !isId(o.itemId)) throw new RequestError('Vínculo inválido.')
        return { type: o.type, itemId: o.itemId }
      })
      return { op: 'create', type: b.type, title, description: text(b.description, 20000), links: parsed }
    }
    case 'update': {
      if (!isKind(b.type) || !isId(b.itemId)) throw new RequestError('Item inválido.')
      const title = text(b.title, 255)?.trim()
      if (b.title !== undefined && !title) throw new RequestError('O título não pode ficar vazio.')
      return { op: 'update', type: b.type, itemId: b.itemId, title, description: text(b.description, 20000) }
    }
    case 'delete':
    case 'duplicate':
      if (!isKind(b.type) || !isId(b.itemId)) throw new RequestError('Item inválido.')
      return { op: b.op, type: b.type, itemId: b.itemId }
    case 'link':
    case 'unlink':
      if ((b.childType !== 'aula' && b.childType !== 'youtube') || !isId(b.childItemId) || !isId(b.infoItemId)) {
        throw new RequestError('Este tipo de conexão ainda não possui armazenamento configurado na monday.')
      }
      return { op: b.op, childType: b.childType, childItemId: b.childItemId, infoItemId: b.infoItemId }
    default:
      throw new RequestError('Operação desconhecida.')
  }
}

/* ------------------------------------------------------------------ GraphQL */

const CREATE = /* GraphQL */ `
  mutation Create($board: ID!, $group: String, $name: String!, $cols: JSON) {
    create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $cols) { id }
  }
`
const CHANGE = /* GraphQL */ `
  mutation Change($board: ID!, $item: ID!, $cols: JSON!) {
    change_multiple_column_values(board_id: $board, item_id: $item, column_values: $cols) { id }
  }
`
const DELETE = /* GraphQL */ `
  mutation Delete($item: ID!) {
    delete_item(item_id: $item) { id }
  }
`

/* ------------------------------------------------------------------ helpers */

async function loadItem(config: MondayConfig, kind: NodeKind, itemId: string): Promise<RawItem> {
  const item = await fetchItem(config, itemId)
  if (!item) throw new RequestError('O item não existe mais na monday. Atualize os dados.')
  // Garante que o item pertence ao quadro esperado para o tipo (não aceitamos ids de outros quadros).
  if (item.board?.id && item.board.id !== config.boards[BOARD_OF[kind]]) throw new RequestError('O item pertence a outro quadro.')
  return item
}

async function contentOf(config: MondayConfig, kind: NodeKind, itemId: string): Promise<{ content: Content; themes: Theme[] }> {
  const key = BOARD_OF[kind]
  const [item, schema] = await Promise.all([loadItem(config, kind, itemId), fetchSchema(config, config.boards[key])])
  const board: RawBoard = { ...schema, items: [item] }
  const { content, themeLabels } = buildContent(key, item, board)
  const themes = themeLabels.map(themeOf)
  content.themes = themes.map((t) => t.id)
  return { content, themes }
}

function relationColumn(child: 'aula' | 'youtube') {
  return child === 'aula' ? COLUMNS.lessonToInfo : COLUMNS.youtubeToInfo
}

/** Adiciona/remove UM infoproduto da relação do filho, preservando os demais (lê a lista atual antes de gravar). */
async function setRelation(config: MondayConfig, child: 'aula' | 'youtube', childItemId: string, infoItemId: string, mode: 'add' | 'remove') {
  const column = relationColumn(child)
  const item = await loadItem(config, child, childItemId)
  const current = relationIds(item, column)
  const next = mode === 'add' ? [...new Set([...current, infoItemId])] : current.filter((id) => id !== infoItemId)
  if (next.length === current.length && next.every((id, i) => id === current[i])) return
  await gql(config, CHANGE, {
    board: config.boards[BOARD_OF[child]],
    item: childItemId,
    cols: JSON.stringify({ [column]: { item_ids: next.map(Number) } }),
  })
}

/** Colunas simples copiadas ao duplicar (nunca relações, pessoas, arquivos, docs, fórmulas ou subitens). */
function copyableColumns(item: RawItem): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const json = (v: string | null) => {
    try {
      return v ? (JSON.parse(v) as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  for (const cv of item.column_values) {
    const text = (cv.text ?? '').trim()
    const value = json(cv.value)
    switch (cv.type) {
      case 'text':
        if (text) out[cv.id] = text
        break
      case 'long_text':
        if (text) out[cv.id] = { text }
        break
      case 'numbers':
        if (text) out[cv.id] = text
        break
      case 'status':
        if (text) out[cv.id] = { label: text }
        break
      case 'dropdown':
        if (text) out[cv.id] = { labels: text.split(',').map((t) => t.trim()).filter(Boolean) }
        break
      case 'checkbox':
        if (value?.checked) out[cv.id] = { checked: 'true' }
        break
      case 'date':
        if (value?.date) out[cv.id] = { date: value.date, ...(value.time ? { time: value.time } : {}) }
        break
      case 'link':
        if (value?.url) out[cv.id] = { url: value.url, text: value.text ?? value.url }
        break
      case 'rating':
        if (value?.rating) out[cv.id] = { rating: value.rating }
        break
      case 'timeline':
        if (value?.from && value?.to) out[cv.id] = { from: value.from, to: value.to }
        break
    }
  }
  return out
}

async function createItem(config: MondayConfig, kind: NodeKind, name: string, cols: Record<string, unknown>): Promise<string> {
  const key = BOARD_OF[kind]
  const data = await gql<{ create_item: { id: string } }>(config, CREATE, {
    board: config.boards[key],
    group: config.newItemGroups[key],
    name,
    cols: Object.keys(cols).length ? JSON.stringify(cols) : null,
  })
  return data.create_item.id
}

/** Duplicação: o nome ganha " — cópia" (sem repetir se já existir) e as relações NÃO são copiadas. */
function copyName(name: string): string {
  return /— cópia( \d+)?$/.test(name) ? name : `${name} — cópia`
}

/* ------------------------------------------------------------------ execução */

export async function runMutation(config: MondayConfig, op: Op): Promise<MutationResult> {
  switch (op.op) {
    case 'create': {
      const cols: Record<string, unknown> = {}
      if (op.type === 'aula' && op.description) cols[COLUMNS.lessonDescription] = { text: op.description }
      const itemId = await createItem(config, op.type, op.title, cols)
      // Vínculos iniciais (opcionais). Se algum falhar o item continua criado; o aviso informa o que ficou faltando.
      let failed = 0
      for (const link of op.links ?? []) {
        try {
          if (op.type === 'infoproduto' && (link.type === 'aula' || link.type === 'youtube')) {
            await setRelation(config, link.type, link.itemId, itemId, 'add')
          } else if ((op.type === 'aula' || op.type === 'youtube') && link.type === 'infoproduto') {
            await setRelation(config, op.type, itemId, link.itemId, 'add')
          } else failed++
        } catch {
          failed++
        }
      }
      const result = await contentOf(config, op.type, itemId)
      return { ok: true, ...result, ...(failed ? { warning: 'O item foi criado, mas alguns vínculos não puderam ser gravados.' } : {}) }
    }
    case 'update': {
      const cols: Record<string, unknown> = {}
      if (op.title !== undefined) cols.name = op.title
      if (op.description !== undefined && op.type === 'aula') cols[COLUMNS.lessonDescription] = { text: op.description }
      await loadItem(config, op.type, op.itemId)
      if (Object.keys(cols).length) {
        await gql(config, CHANGE, { board: config.boards[BOARD_OF[op.type]], item: op.itemId, cols: JSON.stringify(cols) })
      }
      return { ok: true, ...(await contentOf(config, op.type, op.itemId)) }
    }
    case 'delete': {
      await loadItem(config, op.type, op.itemId)
      await gql(config, DELETE, { item: op.itemId })
      return { ok: true, deleted: `${NODE_PREFIX[BOARD_OF[op.type]]}:${op.itemId}` }
    }
    case 'link':
    case 'unlink': {
      await loadItem(config, 'infoproduto', op.infoItemId)
      await setRelation(config, op.childType, op.childItemId, op.infoItemId, op.op === 'link' ? 'add' : 'remove')
      return { ok: true }
    }
    case 'duplicate': {
      const item = await loadItem(config, op.type, op.itemId)
      const name = copyName(item.name)
      let warning: string | undefined
      let newId: string
      try {
        newId = await createItem(config, op.type, name, copyableColumns(item))
      } catch (error) {
        if (!(error instanceof MondayError)) throw error
        newId = await createItem(config, op.type, name, {})
        warning = 'A cópia foi criada sem alguns campos, que a monday não aceitou copiar.'
      }
      return { ok: true, warning, ...(await contentOf(config, op.type, newId)) }
    }
  }
}
