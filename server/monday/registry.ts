import { MondayError, fetchBoard, fetchSchema, gql } from './client.js'
import type { BoardSchema } from './client.js'
import type { BoardKey, MondayConfig, RawBoard, RawItem } from './types.js'
import { CONTENT_BRAIN_ID, CORE_CONNECTIONS, CORE_NODE_TYPES } from '../../src/brains/content/core.js'
import type { ConnectionDef, NodeTypeDef, SchemaPayload } from '../../src/types/schema.js'

/**
 * Registry do Segundo Cérebro na monday. Dois boards administrativos (que NÃO são conteúdo do grafo):
 *   "SC | Estrutura"  → um item (todos os cérebros; coluna Brain ID) por tipo de conteúdo (NodeType)
 *   "SC | Relações"   → um item (todos os cérebros; coluna Brain ID) por regra de conexão (ConnectionType)
 * Cada campo tem sua própria coluna (nada de JSON em um campo só). As colunas são localizadas pelo TÍTULO, então o servidor
 * não depende de ids fixos. Enquanto o registry não existe, valem os tipos núcleo (boards já existentes) como padrão.
 */

/** "SC" é só o prefixo técnico dos boards gerados pela plataforma na monday (o produto continua se chamando Segundo Cérebro). */
export const BOARD_NAME_PREFIX = 'SC | '
export const REGISTRY_BOARD_NAMES = {
  nodeTypes: `${BOARD_NAME_PREFIX}Estrutura`,
  connections: `${BOARD_NAME_PREFIX}Relações`,
} as const
/** Nomes anteriores dos boards de registry: reconhecidos e renomeados (nunca recriados). */
export const LEGACY_REGISTRY_BOARD_NAMES = {
  nodeTypes: 'Segundo Cérebro | Estrutura',
  connections: 'Segundo Cérebro | Relações',
} as const

/** Nome do board de um tipo novo: `SC | {Cérebro} | {Tipo}`. Centralizado aqui para manter o padrão em todo lugar. */
export const boardNameFor = (brainName: string, typeLabel: string) => `${BOARD_NAME_PREFIX}${brainName.trim()} | ${typeLabel.trim()}`

export class RequestError extends Error {
  constructor(
    message: string,
    public code = 'bad_request',
  ) {
    super(message)
  }
}

/** Falha no meio de uma criação estrutural: o que já foi feito fica registrado para o usuário tentar concluir. */
export class PartialError extends Error {
  constructor(
    message: string,
    public details: { boardId?: string; boardName?: string; completed: string[]; failedStep: string },
  ) {
    super(message)
  }
}

/* ------------------------------------------------------------------ colunas do registry */

export type ColumnKind = 'text' | 'long_text' | 'status' | 'checkbox'

export interface ColumnSpec {
  title: string
  kind: ColumnKind
  labels?: string[]
}

export const NODE_TYPE_COLUMNS: ColumnSpec[] = [
  { title: 'Slug', kind: 'text' },
  { title: 'Brain ID', kind: 'text' },
  { title: 'Plural', kind: 'text' },
  { title: 'Descrição', kind: 'long_text' },
  { title: 'Board ID', kind: 'text' },
  { title: 'Workspace ID', kind: 'text' },
  { title: 'Folder ID', kind: 'text' },
  { title: 'Ícone', kind: 'text' },
  { title: 'Cor', kind: 'text' },
  { title: 'Papel', kind: 'status', labels: ['Núcleo', 'Personalizado'] },
  { title: 'Coluna de descrição (ID)', kind: 'text' },
  { title: 'Prefixo', kind: 'text' },
  { title: 'Ativo', kind: 'checkbox' },
]

export const CONNECTION_COLUMNS: ColumnSpec[] = [
  { title: 'Slug', kind: 'text' },
  { title: 'Brain ID', kind: 'text' },
  { title: 'Origem (tipo)', kind: 'text' },
  { title: 'Destino (tipo)', kind: 'text' },
  { title: 'Rótulo', kind: 'text' },
  { title: 'Rótulo inverso', kind: 'text' },
  { title: 'Natureza', kind: 'status', labels: ['Hierarquia', 'Associação'] },
  { title: 'Cardinalidade', kind: 'status', labels: ['Um para um', 'Um para muitos', 'Muitos para muitos'] },
  { title: 'Coluna em', kind: 'status', labels: ['Origem', 'Destino'] },
  { title: 'Coluna (ID)', kind: 'text' },
  { title: 'Coluna refletida (ID)', kind: 'text' },
  { title: 'Descrição', kind: 'long_text' },
  { title: 'Ativo', kind: 'checkbox' },
]

const NATURE_LABEL = { hierarchy: 'Hierarquia', association: 'Associação' } as const
const CARDINALITY_LABEL = { 'one-one': 'Um para um', 'one-many': 'Um para muitos', 'many-many': 'Muitos para muitos' } as const

/* ------------------------------------------------------------------ localização (workspace / pasta) */

export interface Location {
  workspace: { id: string; name: string } | null
  folder: { id: string; name: string } | null
  /** Os boards núcleo não estão todos na mesma pasta: a pasta do Conteúdo precisa ser escolhida de forma explícita. */
  ambiguous: boolean
  folderBoards: { id: string; name: string }[]
  coreBoards: Record<BoardKey, { id: string; name: string }>
  accountSlug: string
}

const LOCATION_QUERY = /* GraphQL */ `
  query Location($ids: [ID!]) {
    me { account { slug } }
    boards(ids: $ids) { id name workspace_id board_folder_id }
  }
`
const WORKSPACE_QUERY = /* GraphQL */ `
  query Workspace($ws: [ID!], $folderWs: [ID!]) {
    workspaces(ids: $ws) { id name }
    folders(workspace_ids: $folderWs, limit: 100) { id name children { id name } }
  }
`

export async function discoverLocation(config: MondayConfig): Promise<Location> {
  const keys: BoardKey[] = ['infoproducts', 'courses', 'youtube']
  const data = await gql<{ me: { account: { slug: string } }; boards: { id: string; name: string; workspace_id: string | null; board_folder_id: string | null }[] }>(
    config,
    LOCATION_QUERY,
    { ids: keys.map((k) => config.boards[k]) },
  )
  const byId = new Map(data.boards.map((b) => [b.id, b]))
  const coreBoards = {} as Location['coreBoards']
  for (const k of keys) {
    const b = byId.get(config.boards[k])
    if (!b) throw new MondayError('monday_error', `Board ${config.boards[k]} não encontrado ou sem permissão para o token.`)
    coreBoards[k] = { id: b.id, name: b.name }
  }
  const workspaces = new Set(data.boards.map((b) => b.workspace_id ?? ''))
  const folders = new Set(data.boards.map((b) => b.board_folder_id ?? ''))
  const workspaceId = [...workspaces][0]
  const folderId = [...folders][0]
  const ambiguous = workspaces.size !== 1 || folders.size !== 1 || !workspaceId || !folderId
  let workspace: Location['workspace'] = null
  let folder: Location['folder'] = null
  let folderBoards: Location['folderBoards'] = []
  if (!ambiguous) {
    const info = await gql<{ workspaces: { id: string; name: string }[]; folders: { id: string; name: string; children: { id: string; name: string }[] }[] }>(
      config,
      WORKSPACE_QUERY,
      { ws: [workspaceId], folderWs: [workspaceId] },
    )
    workspace = { id: workspaceId, name: info.workspaces?.[0]?.name ?? workspaceId }
    const f = info.folders?.find((x) => x.id === folderId)
    folder = { id: folderId, name: f?.name ?? folderId }
    folderBoards = f?.children ?? []
  }
  return { workspace, folder, ambiguous, folderBoards, coreBoards, accountSlug: data.me?.account?.slug ?? '' }
}

/* ------------------------------------------------------------------ descoberta das colunas núcleo */

function boardIdsOf(settings: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(settings ?? '{}') as { boardIds?: (number | string)[]; boardId?: number | string }
    return [...(parsed.boardIds ?? []), ...(parsed.boardId !== undefined ? [parsed.boardId] : [])].map(String)
  } catch {
    return []
  }
}

/** Colunas Connect Boards de `schema` que apontam para `targetBoardId`. */
export function relationColumnsTo(schema: Pick<BoardSchema, 'columns'>, targetBoardId: string) {
  return schema.columns.filter((c) => c.type === 'board_relation' && boardIdsOf(c.settings_str).includes(targetBoardId))
}

async function discoverCoreColumns(config: MondayConfig): Promise<Record<string, { columnId: string; reflectionColumnId?: string }>> {
  const boardOf = (slug: string) => config.boards[CORE_NODE_TYPES.find((t) => t.slug === slug)!.boardKey]
  const schemas = new Map<string, BoardSchema>()
  const schemaOf = async (id: string) => {
    if (!schemas.has(id)) schemas.set(id, await fetchSchema(config, id))
    return schemas.get(id)!
  }
  const out: Record<string, { columnId: string; reflectionColumnId?: string }> = {}
  for (const c of CORE_CONNECTIONS) {
    const storedBoard = boardOf(c.storedOn === 'source' ? c.source : c.target)
    const otherBoard = boardOf(c.storedOn === 'source' ? c.target : c.source)
    const stored = relationColumnsTo(await schemaOf(storedBoard), otherBoard)
    if (stored.length === 0) throw new MondayError('monday_error', `Coluna de conexão de "${c.name}" não encontrada no board ${storedBoard}.`)
    const reflection = relationColumnsTo(await schemaOf(otherBoard), storedBoard)
    out[c.id] = { columnId: stored[0].id, reflectionColumnId: reflection[0]?.id }
  }
  return out
}

/* ------------------------------------------------------------------ leitura do registry */

export interface RegistryHandle {
  nodeTypes: { boardId: string; columns: Record<string, string> }
  connections: { boardId: string; columns: Record<string, string> }
}

export interface LoadedRegistry {
  schema: SchemaPayload
  handle: RegistryHandle | null
  location: Location
}

const cell = (item: RawItem, cols: Record<string, string>, title: string): string => {
  const id = cols[title]
  const cv = id ? item.column_values.find((c) => c.id === id) : undefined
  return (cv?.text ?? '').trim()
}

const checked = (item: RawItem, cols: Record<string, string>, title: string) => cell(item, cols, title) === 'v'

function columnsByTitle(board: { columns: { id: string; title: string }[] }): Record<string, string> {
  return Object.fromEntries(board.columns.map((c) => [c.title, c.id]))
}

function parseNodeTypes(board: RawBoard, location: Location): NodeTypeDef[] {
  const cols = columnsByTitle(board)
  const out: NodeTypeDef[] = []
  for (const item of board.items) {
    const slug = cell(item, cols, 'Slug')
    const boardId = cell(item, cols, 'Board ID')
    if (!slug || !boardId) continue
    out.push({
      slug,
      brainId: cell(item, cols, 'Brain ID') || CONTENT_BRAIN_ID,
      name: item.name.trim(),
      plural: cell(item, cols, 'Plural') || item.name.trim(),
      description: cell(item, cols, 'Descrição'),
      icon: cell(item, cols, 'Ícone') || 'box',
      accent: cell(item, cols, 'Cor') || '#93a4cc',
      role: cell(item, cols, 'Papel') === 'Núcleo' ? 'core' : 'custom',
      active: checked(item, cols, 'Ativo'),
      boardId,
      workspaceId: cell(item, cols, 'Workspace ID') || location.workspace?.id || '',
      folderId: cell(item, cols, 'Folder ID') || location.folder?.id || '',
      descriptionColumnId: cell(item, cols, 'Coluna de descrição (ID)') || undefined,
      prefix: cell(item, cols, 'Prefixo') || slug,
      registryItemId: item.id,
    })
  }
  return out
}

function parseConnections(board: RawBoard): ConnectionDef[] {
  const cols = columnsByTitle(board)
  const natureOf = (t: string) => (t === 'Hierarquia' ? 'hierarchy' : 'association')
  const cardOf = (t: string) => (t === 'Um para um' ? 'one-one' : t === 'Um para muitos' ? 'one-many' : 'many-many')
  const out: ConnectionDef[] = []
  for (const item of board.items) {
    const id = cell(item, cols, 'Slug')
    const source = cell(item, cols, 'Origem (tipo)')
    const target = cell(item, cols, 'Destino (tipo)')
    const columnId = cell(item, cols, 'Coluna (ID)')
    if (!id || !source || !target || !columnId) continue
    out.push({
      id,
      brainId: cell(item, cols, 'Brain ID') || CONTENT_BRAIN_ID,
      name: item.name.trim(),
      label: cell(item, cols, 'Rótulo') || 'se conecta a',
      reverseLabel: cell(item, cols, 'Rótulo inverso') || 'conectado a',
      source,
      target,
      nature: natureOf(cell(item, cols, 'Natureza')),
      cardinality: cardOf(cell(item, cols, 'Cardinalidade')),
      storedOn: cell(item, cols, 'Coluna em') === 'Destino' ? 'target' : 'source',
      columnId,
      reflectionColumnId: cell(item, cols, 'Coluna refletida (ID)') || undefined,
      description: cell(item, cols, 'Descrição') || undefined,
      active: checked(item, cols, 'Ativo'),
      registryItemId: item.id,
    })
  }
  return out
}

/** Estrutura padrão (tipos núcleo e as duas conexões que já existem), com os ids reais descobertos no schema dos boards. */
async function defaultSchema(config: MondayConfig, location: Location): Promise<{ nodeTypes: NodeTypeDef[]; connections: ConnectionDef[] }> {
  const columns = await discoverCoreColumns(config)
  const nodeTypes: NodeTypeDef[] = CORE_NODE_TYPES.map((t) => ({
    slug: t.slug,
    brainId: CONTENT_BRAIN_ID,
    name: t.name,
    plural: t.plural,
    description: t.description,
    icon: t.icon,
    accent: t.accent,
    role: 'core',
    active: true,
    boardId: location.coreBoards[t.boardKey].id,
    boardName: location.coreBoards[t.boardKey].name,
    workspaceId: location.workspace?.id ?? '',
    folderId: location.folder?.id ?? '',
    descriptionColumnId: t.descriptionColumnId,
    prefix: t.prefix,
  }))
  const connections: ConnectionDef[] = CORE_CONNECTIONS.map((c) => ({
    ...c,
    brainId: CONTENT_BRAIN_ID,
    columnId: columns[c.id].columnId,
    reflectionColumnId: columns[c.id].reflectionColumnId,
    active: true,
  }))
  return { nodeTypes, connections }
}

function structureFlags(env: Record<string, string | undefined>) {
  const flag = env.MONDAY_STRUCTURE_ENABLED?.trim()
  // Em desenvolvimento (fora da Vercel) é permitido por padrão; na Vercel precisa ser habilitado de forma explícita.
  const enabled = flag === '1' || (flag !== '0' && !env.VERCEL)
  return { enabled, keyRequired: Boolean(env.SCHEMA_ADMIN_KEY?.trim()) }
}

const TTL_MS = 60_000
let cached: { at: number; key: string; value: LoadedRegistry } | null = null

export function invalidateRegistry() {
  cached = null
}

async function boardNames(config: MondayConfig, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const data = await gql<{ boards: { id: string; name: string }[] }>(config, 'query($ids:[ID!]){ boards(ids:$ids){ id name } }', { ids })
  return new Map(data.boards.map((b) => [b.id, b.name]))
}

/** Localiza os boards de registry: ids do ambiente ou, na falta deles, pelo nome dentro da pasta do Conteúdo. */
function findRegistryBoards(config: MondayConfig, location: Location, env: Record<string, string | undefined>) {
  const byName = (...names: string[]) => location.folderBoards.find((b) => names.includes(b.name))?.id
  const nodeTypes = env.MONDAY_SCHEMA_NODETYPES_BOARD_ID?.trim() || byName(REGISTRY_BOARD_NAMES.nodeTypes, LEGACY_REGISTRY_BOARD_NAMES.nodeTypes)
  const connections = env.MONDAY_SCHEMA_CONNECTIONS_BOARD_ID?.trim() || byName(REGISTRY_BOARD_NAMES.connections, LEGACY_REGISTRY_BOARD_NAMES.connections)
  return nodeTypes && connections ? { nodeTypes, connections } : null
}

export async function loadRegistry(config: MondayConfig, env: Record<string, string | undefined> = process.env, force = false): Promise<LoadedRegistry> {
  const key = `${config.boards.infoproducts}|${config.boards.courses}|${config.boards.youtube}`
  if (!force && cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.value
  const location = await discoverLocation(config)
  const flags = structureFlags(env)
  const ids = findRegistryBoards(config, location, env)
  let nodeTypes: NodeTypeDef[]
  let connections: ConnectionDef[]
  let handle: RegistryHandle | null = null
  if (ids) {
    const [nt, cn] = await Promise.all([fetchBoard(config, ids.nodeTypes), fetchBoard(config, ids.connections)])
    nodeTypes = parseNodeTypes(nt, location)
    connections = parseConnections(cn)
    handle = { nodeTypes: { boardId: nt.id, columns: columnsByTitle(nt) }, connections: { boardId: cn.id, columns: columnsByTitle(cn) } }
  } else {
    ;({ nodeTypes, connections } = await defaultSchema(config, location))
  }
  // Nomes dos boards: a lista da pasta já os traz; só o que faltar (board fora da pasta) é consultado.
  const names = new Map(location.folderBoards.map((b) => [b.id, b.name]))
  const missing = [...new Set(nodeTypes.map((t) => t.boardId))].filter((id) => !names.has(id))
  for (const [id, name] of await boardNames(config, missing)) names.set(id, name)
  for (const t of nodeTypes) t.boardName = names.get(t.boardId) ?? t.boardName
  const schema: SchemaPayload = {
    initialized: Boolean(ids),
    workspace: location.workspace,
    folder: location.folder,
    baseUrl: location.accountSlug ? `https://${location.accountSlug}.monday.com` : '',
    nodeTypes,
    connections,
    registryBoards: ids ? { nodeTypes: ids.nodeTypes, connections: ids.connections } : null,
    structure: flags,
  }
  const value = { schema, handle, location }
  cached = { at: Date.now(), key, value }
  return value
}

/* ------------------------------------------------------------------ escrita estrutural */

export const CREATE_BOARD = /* GraphQL */ `
  mutation CreateBoard($name: String!, $ws: ID, $folder: ID) {
    create_board(board_name: $name, board_kind: public, workspace_id: $ws, folder_id: $folder) { id name board_folder_id workspace { id } }
  }
`
const RENAME_BOARD = /* GraphQL */ `
  mutation RenameBoard($board: ID!, $name: String!) {
    update_board(board_id: $board, board_attribute: name, new_value: $name)
  }
`
const CREATE_COLUMN = /* GraphQL */ `
  mutation CreateColumn($board: ID!, $title: String!, $type: ColumnType!, $defaults: JSON) {
    create_column(board_id: $board, title: $title, column_type: $type, defaults: $defaults) { id title type settings_str }
  }
`
const CREATE_ITEM = /* GraphQL */ `
  mutation CreateRow($board: ID!, $group: String, $name: String!, $cols: JSON) {
    create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $cols) { id }
  }
`

/**
 * A monday cria todo board novo com um item de exemplo ("Task 1"). Num board que acabamos de criar isso viraria um nó
 * fantasma no mapa, então os itens de exemplo (e só eles) são removidos logo após a criação.
 */
async function clearSampleItems(config: MondayConfig, boardId: string): Promise<void> {
  const data = await gql<{ boards: { items_page: { items: { id: string; name: string }[] } }[] }>(
    config,
    'query($b:[ID!]){ boards(ids:$b){ items_page(limit:20){ items{ id name } } } }',
    { b: [boardId] },
  )
  for (const item of data.boards?.[0]?.items_page?.items ?? []) {
    if (/^Task \d+$/.test(item.name)) await gql(config, 'mutation($i:ID!){ delete_item(item_id:$i){ id } }', { i: item.id })
  }
}

export async function createBoard(config: MondayConfig, name: string, location: { workspaceId: string; folderId: string }): Promise<string> {
  const data = await gql<{ create_board: { id: string; board_folder_id: string | null } }>(config, CREATE_BOARD, {
    name,
    ws: location.workspaceId,
    folder: location.folderId,
  })
  const created = data.create_board
  await clearSampleItems(config, created.id)
  if (created.board_folder_id !== location.folderId) {
    throw new PartialError('O board foi criado, mas não ficou na pasta esperada.', {
      boardId: created.id,
      boardName: name,
      completed: ['create_board'],
      failedStep: 'move_to_folder',
    })
  }
  return created.id
}

const COLUMN_TYPE: Record<ColumnKind, string> = { text: 'text', long_text: 'long_text', status: 'status', checkbox: 'checkbox' }

export async function createColumn(config: MondayConfig, boardId: string, spec: ColumnSpec): Promise<{ id: string; title: string }> {
  const defaults = spec.kind === 'status' ? JSON.stringify({ labels: Object.fromEntries((spec.labels ?? []).map((l, i) => [String(i), l])) }) : null
  const data = await gql<{ create_column: { id: string; title: string } }>(config, CREATE_COLUMN, {
    board: boardId,
    title: spec.title,
    type: COLUMN_TYPE[spec.kind],
    defaults,
  })
  return data.create_column
}

/** Garante as colunas (por título). Retorna título → id. Idempotente: não recria o que já existe. */
export async function ensureColumns(config: MondayConfig, boardId: string, specs: ColumnSpec[]): Promise<Record<string, string>> {
  const schema = await fetchSchema(config, boardId)
  const have = columnsByTitle(schema)
  for (const spec of specs) {
    if (!have[spec.title]) have[spec.title] = (await createColumn(config, boardId, spec)).id
  }
  return have
}

export async function createRelationColumn(
  config: MondayConfig,
  boardId: string,
  title: string,
  targetBoardId: string,
  options: { multiple: boolean; reflection: boolean },
): Promise<{ id: string }> {
  const data = await gql<{ create_column: { id: string } }>(config, CREATE_COLUMN, {
    board: boardId,
    title,
    type: 'board_relation',
    defaults: JSON.stringify({
      boardIds: [Number(targetBoardId)],
      allowMultipleItems: options.multiple,
      allowCreateReflectionColumn: options.reflection,
    }),
  })
  return data.create_column
}

export async function firstGroupId(config: MondayConfig, boardId: string): Promise<string | undefined> {
  const schema = await fetchSchema(config, boardId)
  return schema.groups[0]?.id
}

/** Converte valores simples para o formato de `column_values` da monday. */
function toColumnValues(cols: Record<string, string>, values: Record<string, string | boolean | undefined>, specs: ColumnSpec[]) {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const v = values[spec.title]
    const id = cols[spec.title]
    if (!id || v === undefined || v === '') continue
    if (spec.kind === 'text') out[id] = String(v)
    else if (spec.kind === 'long_text') out[id] = { text: String(v) }
    else if (spec.kind === 'status') out[id] = { label: String(v) }
    else if (spec.kind === 'checkbox') out[id] = v ? { checked: 'true' } : { checked: 'false' }
  }
  return out
}

export async function addNodeTypeRow(config: MondayConfig, handle: RegistryHandle, t: Omit<NodeTypeDef, 'registryItemId' | 'boardName'>): Promise<string> {
  const values = {
    Slug: t.slug,
    'Brain ID': t.brainId,
    Plural: t.plural,
    Descrição: t.description,
    'Board ID': t.boardId,
    'Workspace ID': t.workspaceId,
    'Folder ID': t.folderId,
    Ícone: t.icon,
    Cor: t.accent,
    Papel: t.role === 'core' ? 'Núcleo' : 'Personalizado',
    'Coluna de descrição (ID)': t.descriptionColumnId,
    Prefixo: t.prefix,
    Ativo: t.active,
  }
  const data = await gql<{ create_item: { id: string } }>(config, CREATE_ITEM, {
    board: handle.nodeTypes.boardId,
    group: await firstGroupId(config, handle.nodeTypes.boardId),
    name: t.name,
    cols: JSON.stringify(toColumnValues(handle.nodeTypes.columns, values, NODE_TYPE_COLUMNS)),
  })
  return data.create_item.id
}

export async function addConnectionRow(config: MondayConfig, handle: RegistryHandle, c: Omit<ConnectionDef, 'registryItemId'>): Promise<string> {
  const values = {
    Slug: c.id,
    'Brain ID': c.brainId,
    'Origem (tipo)': c.source,
    'Destino (tipo)': c.target,
    Rótulo: c.label,
    'Rótulo inverso': c.reverseLabel,
    Natureza: NATURE_LABEL[c.nature],
    Cardinalidade: CARDINALITY_LABEL[c.cardinality],
    'Coluna em': c.storedOn === 'source' ? 'Origem' : 'Destino',
    'Coluna (ID)': c.columnId,
    'Coluna refletida (ID)': c.reflectionColumnId,
    Descrição: c.description,
    Ativo: c.active,
  }
  const data = await gql<{ create_item: { id: string } }>(config, CREATE_ITEM, {
    board: handle.connections.boardId,
    group: await firstGroupId(config, handle.connections.boardId),
    name: c.name,
    cols: JSON.stringify(toColumnValues(handle.connections.columns, values, CONNECTION_COLUMNS)),
  })
  return data.create_item.id
}

/**
 * Inicializa o registry (idempotente): cria os dois boards administrativos na pasta do Conteúdo, se faltarem, e registra os
 * tipos e conexões núcleo SEM tocar nos boards existentes.
 */
export async function initRegistry(config: MondayConfig, env: Record<string, string | undefined> = process.env): Promise<{ created: string[]; renamed: string[]; seededNodeTypes: number; seededConnections: number }> {
  const location = await discoverLocation(config)
  if (location.ambiguous || !location.workspace || !location.folder) {
    throw new RequestError(
      'Os boards de Conteúdo não estão na mesma pasta/workspace. Defina a pasta do cérebro de forma explícita antes de criar a estrutura.',
      'ambiguous_folder',
    )
  }
  const where = { workspaceId: location.workspace.id, folderId: location.folder.id }
  const created: string[] = []
  const found = findRegistryBoards(config, location, env)
  const ntId = found?.nodeTypes ?? (created.push(REGISTRY_BOARD_NAMES.nodeTypes), await createBoard(config, REGISTRY_BOARD_NAMES.nodeTypes, where))
  const cnId = found?.connections ?? (created.push(REGISTRY_BOARD_NAMES.connections), await createBoard(config, REGISTRY_BOARD_NAMES.connections, where))
  // Migração de nome: boards de registry com o prefixo antigo são RENOMEADOS (mesmo board, mesmos dados).
  const renamed: string[] = []
  for (const [id, wanted] of [[ntId, REGISTRY_BOARD_NAMES.nodeTypes], [cnId, REGISTRY_BOARD_NAMES.connections]] as const) {
    const current = (await boardNames(config, [id])).get(id)
    if (current && current !== wanted && Object.values(LEGACY_REGISTRY_BOARD_NAMES).includes(current as never)) {
      await gql(config, RENAME_BOARD, { board: id, name: wanted })
      renamed.push(`${current} → ${wanted}`)
    }
  }
  const [ntCols, cnCols] = await Promise.all([ensureColumns(config, ntId, NODE_TYPE_COLUMNS), ensureColumns(config, cnId, CONNECTION_COLUMNS)])
  const handle: RegistryHandle = { nodeTypes: { boardId: ntId, columns: ntCols }, connections: { boardId: cnId, columns: cnCols } }

  const [nt, cn] = await Promise.all([fetchBoard(config, ntId), fetchBoard(config, cnId)])
  const haveTypes = new Set(parseNodeTypes(nt, location).map((t) => t.slug))
  const haveConns = new Set(parseConnections(cn).map((c) => c.id))
  const defaults = await defaultSchema(config, location)
  let seededNodeTypes = 0
  let seededConnections = 0
  for (const t of defaults.nodeTypes) {
    if (haveTypes.has(t.slug)) continue
    await addNodeTypeRow(config, handle, t)
    seededNodeTypes++
  }
  for (const c of defaults.connections) {
    if (haveConns.has(c.id)) continue
    await addConnectionRow(config, handle, c)
    seededConnections++
  }
  invalidateRegistry()
  return { created, renamed, seededNodeTypes, seededConnections }
}

export type { RawBoard }
