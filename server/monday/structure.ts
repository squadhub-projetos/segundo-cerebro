import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { MondayError, fetchSchema, gql } from './client.js'
import {
  PartialError,
  RequestError,
  addConnectionRow,
  addNodeTypeRow,
  boardNameFor,
  createBoard,
  createRelationColumn,
  ensureColumns,
  initRegistry,
  invalidateRegistry,
  loadRegistry,
  relationColumnsTo,
} from './registry.js'
import type { LoadedRegistry } from './registry.js'
import type { MondayConfig } from './types.js'
import { BRAIN_CATALOG, brainCatalogEntry } from '../../src/brains/catalog.js'
import { CONTENT_BRAIN_ID } from '../../src/brains/content/core.js'
import type { Cardinality, ConnectionDef, ConnectionNature, NodeTypeDef } from '../../src/types/schema.js'

/**
 * Alterações ESTRUTURAIS do schema (criar tipo = criar board; criar conexão = criar coluna Connect Boards). Muito mais
 * sensíveis que o CRUD de itens, por isso passam por uma proteção própria: habilitação explícita e chave de administração.
 */

const PALETTE = ['#7cdfd0', '#c59bf0', '#ebc17a', '#f0a07c', '#e88fb8', '#7cb8ef', '#9fb3d9', '#b7e07c']
/** Colunas que todo board novo recebe (o nome já existe). Nada de dezenas de colunas preventivas. */
const NEW_TYPE_COLUMNS = [
  { title: 'Descrição', kind: 'long_text' as const },
  { title: 'Status', kind: 'status' as const, labels: ['Em produção', 'Finalizado', 'Publicado'] },
]

/* ------------------------------------------------------------------ proteção */

export interface Denied {
  status: number
  error: string
  message: string
}

/** Retorna o motivo de recusa, ou null quando a requisição pode alterar a estrutura. */
export function structureDenied(req: IncomingMessage, env: Record<string, string | undefined>): Denied | null {
  const flag = env.MONDAY_STRUCTURE_ENABLED?.trim()
  const enabled = flag === '1' || (flag !== '0' && !env.VERCEL)
  if (!enabled) {
    return { status: 403, error: 'structure_disabled', message: 'Alterações estruturais estão desabilitadas neste ambiente (MONDAY_STRUCTURE_ENABLED).' }
  }
  if (env.MONDAY_WRITE_ENABLED?.trim() === '0') {
    return { status: 403, error: 'writes_disabled', message: 'Escrita na monday está desabilitada (MONDAY_WRITE_ENABLED=0).' }
  }
  const key = env.SCHEMA_ADMIN_KEY?.trim()
  if (!key) {
    // Em produção a chave é obrigatória; em desenvolvimento local, sem chave, só vale na própria máquina.
    if (env.VERCEL) {
      return { status: 403, error: 'admin_key_missing', message: 'Defina SCHEMA_ADMIN_KEY no servidor para permitir alterações estruturais em produção.' }
    }
    return null
  }
  const sent = String(req.headers['x-admin-key'] ?? '')
  if (!sent) return { status: 401, error: 'admin_key_required', message: 'Informe a chave de administração para alterar a estrutura.' }
  const a = Buffer.from(sent)
  const b = Buffer.from(key)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: 403, error: 'admin_key_invalid', message: 'Chave de administração inválida.' }
  }
  return null
}

/* ------------------------------------------------------------------ helpers */

export const slugify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'tipo'
  let slug = root
  for (let i = 2; taken.has(slug); i++) slug = `${root}-${i}`
  return slug
}

function brainLocation(reg: LoadedRegistry, brainId: string) {
  const types = reg.schema.nodeTypes.filter((t) => t.brainId === brainId && t.active)
  const folders = new Set(types.map((t) => t.folderId).filter(Boolean))
  const workspaces = new Set(types.map((t) => t.workspaceId).filter(Boolean))
  if (types.length === 0 && reg.location.workspace && reg.location.folder) {
    return { workspaceId: reg.location.workspace.id, folderId: reg.location.folder.id }
  }
  if (folders.size !== 1 || workspaces.size !== 1) {
    throw new RequestError(
      'Os tipos deste cérebro estão em pastas diferentes. Defina a pasta do cérebro de forma explícita antes de criar novos tipos.',
      'ambiguous_folder',
    )
  }
  return { workspaceId: [...workspaces][0], folderId: [...folders][0] }
}

/* ------------------------------------------------------------------ status / permissões */

export async function structureStatus(config: MondayConfig, env: Record<string, string | undefined>) {
  const reg = await loadRegistry(config, env)
  const me = await gql<{ me: { name: string; is_admin: boolean; is_guest: boolean } }>(config, 'query { me { name is_admin is_guest } }', {})
  const flag = env.MONDAY_STRUCTURE_ENABLED?.trim()
  return {
    initialized: reg.schema.initialized,
    workspace: reg.location.workspace,
    folder: reg.location.folder,
    ambiguousFolder: reg.location.ambiguous,
    registryBoards: reg.schema.registryBoards,
    structure: reg.schema.structure,
    writesEnabled: env.MONDAY_WRITE_ENABLED?.trim() !== '0',
    structureEnabled: flag === '1' || (flag !== '0' && !env.VERCEL),
    user: { name: me.me.name, isAdmin: me.me.is_admin, isGuest: me.me.is_guest },
    // O token só consegue ler workspace/pasta se tiver `workspaces:read`; criar boards/colunas exige `boards:write`.
    // Esta última só é confirmada de fato ao criar: qualquer recusa da monday volta como erro claro.
    permissions: {
      workspacesRead: Boolean(reg.location.workspace),
      note: 'boards:write e workspaces:write são verificados na criação; recusas da monday são exibidas com a causa.',
    },
  }
}

/** Traduz recusas de permissão da monday para mensagens claras. */
export function friendlyMondayError(error: unknown): unknown {
  if (error instanceof MondayError && /scope|permission|unauthori[sz]ed|not allowed|access/i.test(error.message)) {
    return new MondayError('monday_error', `O token da monday não tem permissão para esta operação (boards:write, workspaces:read/write). Detalhe: ${error.message}`)
  }
  return error
}

/* ------------------------------------------------------------------ tipo de conteúdo */

export interface NodeTypeInput {
  name: string
  /** Nome no plural (usado no nome do board e no filtro). Sem valor, igual ao nome. */
  plural: string
  description: string
  brainId: string
  icon: string
}

function cleanNodeTypeInput(body: Record<string, unknown>): NodeTypeInput {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (name.length < 2 || name.length > 60) throw new RequestError('Informe um nome com 2 a 60 caracteres.')
  if (!slugify(name)) throw new RequestError('O nome precisa ter letras ou números.')
  const brainId = typeof body.brainId === 'string' ? body.brainId : CONTENT_BRAIN_ID
  if (!brainCatalogEntry(brainId)) throw new RequestError(`Cérebro desconhecido. Disponíveis: ${BRAIN_CATALOG.map((b) => b.id).join(', ')}.`)
  const pluralRaw = typeof body.plural === 'string' ? body.plural.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  const icon = typeof body.icon === 'string' && /^[a-z0-9-]{1,30}$/.test(body.icon) ? body.icon : 'box'
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : ''
  return { name, plural: pluralRaw || name, description, brainId, icon }
}

export async function planNodeType(config: MondayConfig, env: Record<string, string | undefined>, body: Record<string, unknown>) {
  const input = cleanNodeTypeInput(body)
  const reg = await loadRegistry(config, env, true)
  const where = brainLocation(reg, input.brainId)
  // Nomes repetidos só conflitam DENTRO do mesmo cérebro (cérebros diferentes podem ter tipos com o mesmo nome).
  if (reg.schema.nodeTypes.some((t) => t.brainId === input.brainId && t.name.toLowerCase() === input.name.toLowerCase())) {
    throw new RequestError(`Já existe um tipo chamado "${input.name}" neste cérebro.`)
  }
  const brainName = brainCatalogEntry(input.brainId)!.name
  return {
    input,
    brainName,
    boardName: boardNameFor(brainName, input.plural),
    workspace: reg.location.workspace,
    folder: reg.location.folder,
    folderId: where.folderId,
    columns: NEW_TYPE_COLUMNS.map((c) => c.title),
    initializesRegistry: !reg.schema.initialized,
  }
}

/**
 * Cria um tipo: board na pasta do cérebro → colunas básicas → registro. Idempotente por etapa: se algo falhar no meio, a
 * mesma chamada retoma de onde parou (reaproveita o board vazio já criado). Nada é apagado automaticamente.
 */
export async function createNodeType(config: MondayConfig, env: Record<string, string | undefined>, body: Record<string, unknown>) {
  const plan = await planNodeType(config, env, body)
  const { input } = plan
  const completed: string[] = []
  let reg = await loadRegistry(config, env, true)
  if (!reg.schema.initialized) {
    await initRegistry(config, env)
    completed.push('registry_init')
    reg = await loadRegistry(config, env, true)
  }
  if (!reg.handle) throw new RequestError('Não foi possível localizar o registry na monday.', 'registry_missing')
  const where = brainLocation(reg, input.brainId)
  const boardName = plan.boardName

  // Retomada: board com este nome na pasta, ainda vazio e fora do registry.
  let boardId = reg.location.folderBoards.find((b) => b.name === boardName)?.id
  if (boardId) {
    const info = await gql<{ boards: { items_count: number }[] }>(config, 'query($i:[ID!]){ boards(ids:$i){ items_count } }', { i: [boardId] })
    if ((info.boards?.[0]?.items_count ?? 0) > 0) {
      throw new RequestError(`Já existe na pasta um board "${boardName}" com itens. Escolha outro nome.`)
    }
  } else {
    boardId = await createBoard(config, boardName, where)
    completed.push('create_board')
  }

  try {
    const cols = await ensureColumns(config, boardId, NEW_TYPE_COLUMNS.map((c) => ({ title: c.title, kind: c.kind, labels: 'labels' in c ? c.labels : undefined })))
    completed.push('create_columns')
    const taken = new Set(reg.schema.nodeTypes.map((t) => t.slug))
    const slug = uniqueSlug(slugify(input.name), taken)
    const def: Omit<NodeTypeDef, 'registryItemId' | 'boardName'> = {
      slug,
      brainId: input.brainId,
      name: input.name,
      plural: input.plural,
      description: input.description,
      icon: input.icon,
      accent: PALETTE[reg.schema.nodeTypes.filter((t) => t.role === 'custom').length % PALETTE.length],
      role: 'custom',
      active: true,
      boardId,
      workspaceId: where.workspaceId,
      folderId: where.folderId,
      descriptionColumnId: cols['Descrição'],
      prefix: slug,
    }
    await addNodeTypeRow(config, reg.handle, def)
    completed.push('register')
    invalidateRegistry()
    return { nodeType: { ...def, boardName }, completed }
  } catch (error) {
    invalidateRegistry()
    throw new PartialError(
      `Board criado, mas a configuração não foi concluída: ${(error as Error).message}`,
      { boardId, boardName, completed, failedStep: completed.includes('create_columns') ? 'register' : 'create_columns' },
    )
  }
}

/* ------------------------------------------------------------------ tipo de conexão */

export interface ConnectionInput {
  /** Cérebro em que a conexão está sendo criada: origem e destino precisam pertencer a ele. */
  brainId: string
  source: string
  target: string
  label: string
  reverseLabel: string
  nature: ConnectionNature
  cardinality: Cardinality
}

function cleanConnectionInput(body: Record<string, unknown>): ConnectionInput {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
  const source = text(body.source, 60)
  const target = text(body.target, 60)
  const label = text(body.label, 40)
  if (!source || !target) throw new RequestError('Escolha a origem e o destino.')
  if (label.length < 2) throw new RequestError('Informe o nome da relação (por exemplo, "contém").')
  const nature = body.nature === 'hierarchy' ? 'hierarchy' : body.nature === 'association' ? 'association' : null
  if (!nature) throw new RequestError('Escolha a natureza da conexão.')
  const cardinality = body.cardinality === 'one-one' || body.cardinality === 'one-many' || body.cardinality === 'many-many' ? body.cardinality : null
  if (!cardinality) throw new RequestError('Escolha a cardinalidade.')
  const brainId = typeof body.brainId === 'string' && brainCatalogEntry(body.brainId) ? body.brainId : ''
  if (!brainId) throw new RequestError('Informe o cérebro da conexão.')
  return { brainId, source, target, label, reverseLabel: text(body.reverseLabel, 40) || 'conectado a', nature, cardinality }
}

export async function planConnection(config: MondayConfig, env: Record<string, string | undefined>, body: Record<string, unknown>) {
  const input = cleanConnectionInput(body)
  const reg = await loadRegistry(config, env, true)
  if (!reg.schema.initialized) throw new RequestError('Inicialize a estrutura antes de criar conexões.', 'registry_missing')
  const source = reg.schema.nodeTypes.find((t) => t.slug === input.source && t.active)
  const target = reg.schema.nodeTypes.find((t) => t.slug === input.target && t.active)
  if (!source || !target) throw new RequestError('Origem ou destino inexistente.')
  if (source.brainId !== target.brainId) throw new RequestError('Origem e destino precisam ser do mesmo cérebro (conexões entre cérebros ainda não são suportadas).')
  if (source.brainId !== input.brainId) throw new RequestError('Origem e destino não pertencem ao cérebro informado.')
  const dup = reg.schema.connections.find((c) => c.active && c.source === source.slug && c.target === target.slug && c.label.toLowerCase() === input.label.toLowerCase())
  if (dup) throw new RequestError(`Já existe a regra "${source.name} ${dup.label} ${target.name}".`)
  const sameBoard = source.boardId === target.boardId
  return {
    input,
    source,
    target,
    sameBoard,
    columnTitle: target.plural,
    boardName: source.boardName ?? source.name,
    multiple: input.cardinality !== 'one-one',
    reflection: !sameBoard,
  }
}

/** Cria UMA coluna Connect Boards no board de origem (e o reflexo no destino, quando em boards diferentes) e registra a regra. */
export async function createConnection(config: MondayConfig, env: Record<string, string | undefined>, body: Record<string, unknown>) {
  const plan = await planConnection(config, env, body)
  const { input, source, target } = plan
  const reg = await loadRegistry(config, env, true)
  if (!reg.handle) throw new RequestError('Não foi possível localizar o registry na monday.', 'registry_missing')
  const completed: string[] = []

  // Título da coluna: o plural do destino; se já existir uma coluna igual neste board, ganha o rótulo da relação.
  const srcSchema = await fetchSchema(config, source.boardId)
  const titles = new Set(srcSchema.columns.map((c) => c.title))
  const columnTitle = titles.has(plan.columnTitle) ? `${plan.columnTitle} (${input.label})` : plan.columnTitle
  const tgtBefore = plan.sameBoard ? srcSchema : await fetchSchema(config, target.boardId)
  const beforeIds = new Set(relationColumnsTo(tgtBefore, source.boardId).map((c) => c.id))

  // Retomada: coluna criada numa tentativa anterior que não chegou ao registry (mesmo título, mesmo destino, não registrada).
  const registered = new Set(reg.schema.connections.flatMap((c) => [c.columnId, c.reflectionColumnId ?? '']))
  const leftover = relationColumnsTo(srcSchema, target.boardId).find((c) => c.title === plan.columnTitle && !registered.has(c.id))
  let columnId: string
  try {
    columnId = leftover
      ? leftover.id
      : (await createRelationColumn(config, source.boardId, columnTitle, target.boardId, { multiple: plan.multiple, reflection: plan.reflection })).id
    completed.push('create_column')
  } catch (error) {
    throw friendlyMondayError(error)
  }

  try {
    let reflectionColumnId: string | undefined
    if (plan.reflection) {
      const after = await fetchSchema(config, target.boardId)
      const candidates = relationColumnsTo(after, source.boardId).filter((c) => !registered.has(c.id))
      // Normal: a coluna nova que apareceu no destino. Retomada: a não registrada (a monday a intitula "link to <board>").
      reflectionColumnId = (leftover ? (candidates.find((c) => c.title === `link to ${source.boardName}`) ?? candidates[0]) : candidates.find((c) => !beforeIds.has(c.id)))?.id
      completed.push('find_reflection')
    }
    const taken = new Set(reg.schema.connections.map((c) => c.id))
    const id = uniqueSlug(slugify(`${source.slug}-${input.label}-${target.slug}`), taken)
    const def: Omit<ConnectionDef, 'registryItemId'> = {
      id,
      brainId: source.brainId,
      name: `${source.name} ${input.label} ${target.name}`,
      label: input.label,
      reverseLabel: input.reverseLabel,
      source: source.slug,
      target: target.slug,
      nature: input.nature,
      cardinality: input.cardinality,
      storedOn: 'source',
      columnId,
      reflectionColumnId,
      active: true,
    }
    await addConnectionRow(config, reg.handle, def)
    completed.push('register')
    invalidateRegistry()
    return { connection: def, completed }
  } catch (error) {
    invalidateRegistry()
    throw new PartialError(
      `A coluna Connect Boards foi criada, mas a regra não foi registrada: ${(error as Error).message}`,
      { boardId: source.boardId, boardName: source.boardName, completed, failedStep: 'register' },
    )
  }
}
