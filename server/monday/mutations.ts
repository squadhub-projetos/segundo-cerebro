import { MondayError, fetchItem, fetchSchema, gql } from './client.js'
import { buildContent, relationIds, themeOf } from './normalize.js'
import { RequestError, firstGroupId } from './registry.js'
import type { MondayConfig, RawBoard, RawItem } from './types.js'
import type { Content, Theme } from '../../src/types/index.js'
import type { ConnectionDef, NodeTypeDef, SchemaPayload } from '../../src/types/schema.js'

export { RequestError }

/**
 * Escrita de ITENS na monday (criar, editar, excluir, duplicar e ligar/desligar). Dirigida pelo schema: o tipo diz qual board
 * usar e a conexão diz qual coluna Connect Boards guarda a ligação (e em qual lado). Nenhuma coluna ou grupo é criado aqui
 * (isso é estrutura: ver `structure.ts`). A ligação é sempre gravada lendo ANTES a lista atual, porque a coluna é substituída
 * por inteiro; sem isso, as outras ligações do item seriam apagadas.
 */

export type Op =
  | { op: 'create'; type: string; title: string; description?: string; links?: { connection: string; itemId: string; role: 'source' | 'target' }[] }
  | { op: 'update'; type: string; itemId: string; title?: string; description?: string }
  | { op: 'delete'; type: string; itemId: string }
  | { op: 'link' | 'unlink'; connection: string; sourceItemId: string; targetItemId: string }
  | { op: 'duplicate'; type: string; itemId: string }

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
const isSlug = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,60}$/.test(v)

/** Valida o corpo recebido do navegador (nunca confiamos no formato). Os slugs são conferidos contra o schema depois. */
export function parseOp(body: unknown): Op {
  const b = (body ?? {}) as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  switch (b.op) {
    case 'create': {
      const title = text(b.title, 255)?.trim()
      if (!isSlug(b.type) || !title) throw new RequestError('Informe o tipo e o título.')
      const links = (Array.isArray(b.links) ? b.links : []).map((l) => {
        const o = l as { connection?: unknown; itemId?: unknown; role?: unknown }
        if (!isSlug(o.connection) || !isId(o.itemId) || (o.role !== 'source' && o.role !== 'target')) throw new RequestError('Vínculo inválido.')
        return { connection: o.connection, itemId: o.itemId, role: o.role as 'source' | 'target' }
      })
      return { op: 'create', type: b.type, title, description: text(b.description, 20000), links }
    }
    case 'update': {
      if (!isSlug(b.type) || !isId(b.itemId)) throw new RequestError('Item inválido.')
      const title = text(b.title, 255)?.trim()
      if (b.title !== undefined && !title) throw new RequestError('O título não pode ficar vazio.')
      return { op: 'update', type: b.type, itemId: b.itemId, title, description: text(b.description, 20000) }
    }
    case 'delete':
    case 'duplicate':
      if (!isSlug(b.type) || !isId(b.itemId)) throw new RequestError('Item inválido.')
      return { op: b.op, type: b.type, itemId: b.itemId }
    case 'link':
    case 'unlink':
      if (!isSlug(b.connection) || !isId(b.sourceItemId) || !isId(b.targetItemId)) {
        throw new RequestError('Este tipo de conexão ainda não está configurado.')
      }
      return { op: b.op, connection: b.connection, sourceItemId: b.sourceItemId, targetItemId: b.targetItemId }
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

/* ------------------------------------------------------------------ schema */

function typeOf(schema: SchemaPayload, slug: string): NodeTypeDef {
  const t = schema.nodeTypes.find((x) => x.slug === slug && x.active)
  if (!t) throw new RequestError('Tipo de conteúdo desconhecido ou desativado.')
  return t
}

function connectionOf(schema: SchemaPayload, id: string): ConnectionDef {
  const c = schema.connections.find((x) => x.id === id && x.active)
  if (!c) throw new RequestError('Este tipo de conexão ainda não está configurado.')
  return c
}

/* ------------------------------------------------------------------ helpers */

async function loadItem(config: MondayConfig, type: NodeTypeDef, itemId: string): Promise<RawItem> {
  const item = await fetchItem(config, itemId)
  if (!item) throw new RequestError('O item não existe mais na monday. Atualize os dados.')
  // O item precisa pertencer ao board do tipo esperado (não aceitamos ids de outros boards).
  if (item.board?.id && item.board.id !== type.boardId) throw new RequestError('O item pertence a outro quadro.')
  return item
}

async function contentOf(config: MondayConfig, type: NodeTypeDef, itemId: string): Promise<{ content: Content; themes: Theme[] }> {
  const [item, schema] = await Promise.all([loadItem(config, type, itemId), fetchSchema(config, type.boardId)])
  const board: RawBoard = { ...schema, items: [item] }
  const { content, themeLabels } = buildContent(type, item, board)
  const themes = themeLabels.map(themeOf)
  content.themes = themes.map((t) => t.id)
  return { content, themes }
}

/** Itens que a coluna de outro item (a refletida) já liga: usado para respeitar a cardinalidade. */
async function partnersOf(config: MondayConfig, type: NodeTypeDef, itemId: string, columnId: string | undefined): Promise<string[]> {
  if (!columnId) return []
  return relationIds(await loadItem(config, type, itemId), columnId)
}

/** Adiciona/remove UMA ligação preservando as demais (lê a lista atual antes de gravar) e respeitando a cardinalidade. */
async function setRelation(config: MondayConfig, schema: SchemaPayload, conn: ConnectionDef, sourceItemId: string, targetItemId: string, mode: 'add' | 'remove') {
  const sourceType = typeOf(schema, conn.source)
  const targetType = typeOf(schema, conn.target)
  const holderIsSource = conn.storedOn === 'source'
  const holderType = holderIsSource ? sourceType : targetType
  const otherType = holderIsSource ? targetType : sourceType
  const holderId = holderIsSource ? sourceItemId : targetItemId
  const otherId = holderIsSource ? targetItemId : sourceItemId
  const holder = await loadItem(config, holderType, holderId)
  await loadItem(config, otherType, otherId)
  const current = relationIds(holder, conn.columnId)
  if (mode === 'add' && !current.includes(otherId)) {
    if (conn.cardinality === 'one-one' && current.length > 0) throw new RequestError('Este item já possui uma conexão deste tipo (cardinalidade um-para-um).')
    if (conn.cardinality !== 'many-many') {
      // Quem fica do lado "um" não pode ter outro parceiro.
      if (!holderIsSource && current.length > 0) throw new RequestError('O destino já possui uma conexão deste tipo (cardinalidade um-para-muitos).')
      if (holderIsSource) {
        const partners = await partnersOf(config, otherType, otherId, conn.reflectionColumnId)
        if (partners.some((p) => p !== holderId)) throw new RequestError('O destino já está ligado a outra origem (cardinalidade limita a um).')
      }
    }
  }
  const next = mode === 'add' ? [...new Set([...current, otherId])] : current.filter((id) => id !== otherId)
  if (next.length === current.length && next.every((id, i) => id === current[i])) return
  await gql(config, CHANGE, {
    board: holderType.boardId,
    item: holderId,
    cols: JSON.stringify({ [conn.columnId]: { item_ids: next.map(Number) } }),
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

async function createItem(config: MondayConfig, type: NodeTypeDef, name: string, cols: Record<string, unknown>): Promise<string> {
  const data = await gql<{ create_item: { id: string } }>(config, CREATE, {
    board: type.boardId,
    group: await firstGroupId(config, type.boardId),
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

export async function runMutation(config: MondayConfig, op: Op, schema: SchemaPayload): Promise<MutationResult> {
  switch (op.op) {
    case 'create': {
      const type = typeOf(schema, op.type)
      const cols: Record<string, unknown> = {}
      if (type.descriptionColumnId && op.description) cols[type.descriptionColumnId] = { text: op.description }
      const itemId = await createItem(config, type, op.title, cols)
      // Vínculos iniciais (opcionais). Se algum falhar o item continua criado; o aviso informa o que ficou faltando.
      let failed = 0
      for (const link of op.links ?? []) {
        try {
          const conn = connectionOf(schema, link.connection)
          if (link.role === 'source') await setRelation(config, schema, conn, itemId, link.itemId, 'add')
          else await setRelation(config, schema, conn, link.itemId, itemId, 'add')
        } catch {
          failed++
        }
      }
      const result = await contentOf(config, type, itemId)
      return { ok: true, ...result, ...(failed ? { warning: 'O item foi criado, mas alguns vínculos não puderam ser gravados.' } : {}) }
    }
    case 'update': {
      const type = typeOf(schema, op.type)
      const cols: Record<string, unknown> = {}
      if (op.title !== undefined) cols.name = op.title
      if (op.description !== undefined && type.descriptionColumnId) cols[type.descriptionColumnId] = { text: op.description }
      await loadItem(config, type, op.itemId)
      if (Object.keys(cols).length) {
        await gql(config, CHANGE, { board: type.boardId, item: op.itemId, cols: JSON.stringify(cols) })
      }
      return { ok: true, ...(await contentOf(config, type, op.itemId)) }
    }
    case 'delete': {
      const type = typeOf(schema, op.type)
      await loadItem(config, type, op.itemId)
      await gql(config, DELETE, { item: op.itemId })
      return { ok: true, deleted: `${type.prefix}:${op.itemId}` }
    }
    case 'link':
    case 'unlink': {
      const conn = connectionOf(schema, op.connection)
      await setRelation(config, schema, conn, op.sourceItemId, op.targetItemId, op.op === 'link' ? 'add' : 'remove')
      return { ok: true }
    }
    case 'duplicate': {
      const type = typeOf(schema, op.type)
      const item = await loadItem(config, type, op.itemId)
      const name = copyName(item.name)
      let warning: string | undefined
      let newId: string
      try {
        newId = await createItem(config, type, name, copyableColumns(item))
      } catch (error) {
        if (!(error instanceof MondayError)) throw error
        newId = await createItem(config, type, name, {})
        warning = 'A cópia foi criada sem alguns campos, que a monday não aceitou copiar.'
      }
      return { ok: true, warning, ...(await contentOf(config, type, newId)) }
    }
  }
}
