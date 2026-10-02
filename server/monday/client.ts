import type { BoardKey, MondayConfig, RawBoard, RawItem } from './types.js'

const API_URL = 'https://api.monday.com/v2'
const PAGE_SIZE = 200

/** Ids conhecidos como padrão de desenvolvimento; sempre podem ser trocados por variável de ambiente. */
const DEFAULT_BOARDS: Record<BoardKey, string> = {
  infoproducts: '18433730926',
  courses: '18433759798',
  youtube: '18426268819',
}

export class MondayError extends Error {
  constructor(
    public code: 'missing_token' | 'monday_error' | 'network',
    message: string,
  ) {
    super(message)
  }
}

/** Lê a configuração do ambiente do servidor. O token nunca vai para o navegador. */
export function readConfig(env: Record<string, string | undefined>): MondayConfig {
  return {
    token: (env.MONDAY_API_TOKEN ?? '').trim(),
    apiVersion: env.MONDAY_API_VERSION?.trim() || '2025-07',
    boards: {
      infoproducts: env.MONDAY_INFOPRODUCTS_BOARD_ID?.trim() || DEFAULT_BOARDS.infoproducts,
      courses: env.MONDAY_COURSES_BOARD_ID?.trim() || DEFAULT_BOARDS.courses,
      youtube: env.MONDAY_YOUTUBE_BOARD_ID?.trim() || DEFAULT_BOARDS.youtube,
    },
    cacheSeconds: Number(env.MONDAY_CACHE_SECONDS ?? 30) || 0,
    writesEnabled: env.MONDAY_WRITE_ENABLED?.trim() !== '0',
    newItemGroups: {
      infoproducts: env.MONDAY_INFOPRODUCTS_NEW_ITEM_GROUP_ID?.trim() || 'topics',
      courses: env.MONDAY_COURSES_NEW_ITEM_GROUP_ID?.trim() || 'topics',
      youtube: env.MONDAY_YOUTUBE_NEW_ITEM_GROUP_ID?.trim() || 'topics',
    },
  }
}

export async function gql<T>(config: MondayConfig, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!config.token) throw new MondayError('missing_token', 'MONDAY_API_TOKEN não está configurado no servidor.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  let response: Response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.token, 'API-Version': config.apiVersion },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
  } catch (error) {
    throw new MondayError('network', `Falha de rede ao consultar a monday: ${(error as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  const body = (await response.json().catch(() => null)) as { data?: T; errors?: { message: string }[]; error_message?: string } | null
  if (!response.ok || !body || body.errors?.length || body.error_message) {
    const message = body?.errors?.map((e) => e.message).join('; ') ?? body?.error_message ?? `HTTP ${response.status}`
    throw new MondayError('monday_error', `A monday recusou a consulta: ${message}`)
  }
  return body.data as T
}

/* Leitura: schema e itens. As mutations ficam em `mutations.ts`. */

const SCHEMA_QUERY = /* GraphQL */ `
  query Schema($ids: [ID!]) {
    boards(ids: $ids) {
      id
      name
      groups { id title }
      columns { id title type settings_str }
    }
  }
`

const ITEM_FIELDS = /* GraphQL */ `
  id
  name
  url
  group { id title }
  column_values {
    id
    type
    text
    value
    ... on BoardRelationValue { linked_item_ids linked_items { id } }
    ... on MirrorValue { display_value }
  }
`

const FIRST_PAGE = /* GraphQL */ `
  query Items($ids: [ID!], $limit: Int) {
    boards(ids: $ids) {
      items_page(limit: $limit) {
        cursor
        items { ${ITEM_FIELDS} }
      }
    }
  }
`

const NEXT_PAGE = /* GraphQL */ `
  query NextItems($cursor: String!, $limit: Int) {
    next_items_page(limit: $limit, cursor: $cursor) {
      cursor
      items { ${ITEM_FIELDS} }
    }
  }
`

export interface BoardSchema {
  id: string
  name: string
  groups: { id: string; title: string }[]
  columns: { id: string; title: string; type: string; settings_str?: string | null }[]
}

export async function fetchSchema(config: MondayConfig, boardId: string): Promise<BoardSchema> {
  const data = await gql<{ boards: BoardSchema[] }>(config, SCHEMA_QUERY, { ids: [boardId] })
  const board = data.boards?.[0]
  if (!board) throw new MondayError('monday_error', `Quadro ${boardId} não encontrado ou sem permissão para o token.`)
  return board
}

/** Busca todos os itens do quadro (paginação por cursor). */
async function fetchItems(config: MondayConfig, boardId: string): Promise<RawItem[]> {
  const first = await gql<{ boards: { items_page: { cursor: string | null; items: RawItem[] } }[] }>(config, FIRST_PAGE, {
    ids: [boardId],
    limit: PAGE_SIZE,
  })
  const page = first.boards?.[0]?.items_page
  const items: RawItem[] = [...(page?.items ?? [])]
  let cursor = page?.cursor ?? null
  for (let guard = 0; cursor && guard < 100; guard++) {
    const next = await gql<{ next_items_page: { cursor: string | null; items: RawItem[] } }>(config, NEXT_PAGE, {
      cursor,
      limit: PAGE_SIZE,
    })
    items.push(...next.next_items_page.items)
    cursor = next.next_items_page.cursor
  }
  return items
}

export async function fetchBoard(config: MondayConfig, boardId: string): Promise<RawBoard> {
  const [schema, items] = await Promise.all([fetchSchema(config, boardId), fetchItems(config, boardId)])
  return { id: schema.id, name: schema.name, groups: schema.groups, columns: schema.columns, items }
}

const ITEM_QUERY = /* GraphQL */ `
  query Item($ids: [ID!]) {
    items(ids: $ids) { ${ITEM_FIELDS} board { id } }
  }
`

/** Um item (com colunas), ou null se não existir mais. */
export async function fetchItem(config: MondayConfig, itemId: string): Promise<(RawItem & { board?: { id: string } }) | null> {
  const data = await gql<{ items: (RawItem & { board?: { id: string } })[] }>(config, ITEM_QUERY, { ids: [itemId] })
  return data.items?.[0] ?? null
}
