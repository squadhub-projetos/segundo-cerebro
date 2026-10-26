import type { Collection, Content, ContentStatus, GraphPayload, MetaField, Relation, Theme } from '../../src/types/index.js'
import type { ConnectionDef, NodeTypeDef, SchemaPayload } from '../../src/types/schema.js'
import type { RawBoard, RawBoards, RawColumn, RawColumnValue, RawItem } from './types.js'

/**
 * Transforma os boards crus da monday no grafo normalizado que a interface consome. Dirigido pelo SCHEMA (registry):
 *
 *  - cada tipo de conteúdo ativo é um board; cada item do board é um nó (o grupo da monday NÃO vira nó nem relação);
 *  - cada conexão ativa diz em qual coluna Connect Boards a ligação é guardada (e qual é a coluna refletida). A ligação é lida
 *    dos DOIS lados e deduplicada pelo par de ids de nós, então uma relação refletida gera UMA aresta;
 *  - nada é inferido por nome, grupo ou tema. Nada daqui escreve na monday.
 */

/* ------------------------------------------------------------------ texto */

export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ colunas */

const cvText = (cv: RawColumnValue): string => (cv.text ?? cv.display_value ?? '').trim()

function columnMap(board: RawBoard): Map<string, RawColumn> {
  return new Map(board.columns.map((c) => [c.id, c]))
}

/**
 * Ids dos itens ligados por uma coluna Connect Boards. Une `linked_item_ids`, `linked_items` e o `value` bruto: uma coluna
 * refletida pode expor a lista por apenas um desses caminhos.
 */
function linkedIds(cv: RawColumnValue): string[] {
  if (cv.type !== 'board_relation') return []
  const ids = new Set<string>()
  for (const id of cv.linked_item_ids ?? []) ids.add(String(id))
  for (const item of cv.linked_items ?? []) if (item?.id) ids.add(String(item.id))
  try {
    const parsed = JSON.parse(cv.value ?? 'null') as { linkedPulseIds?: { linkedPulseId: number | string }[] } | null
    for (const l of parsed?.linkedPulseIds ?? []) ids.add(String(l.linkedPulseId))
  } catch {
    /* value não é JSON de relação */
  }
  return [...ids]
}

function mapStatus(label: string): ContentStatus {
  const t = fold(label)
  if (/public|lanc|no ar|ativo|live|entreg/.test(t)) return 'publicado'
  if (/final|conclu|pronto|feito|aprovad/.test(t)) return 'finalizado'
  return 'em-producao'
}

function pickStatus(item: RawItem, cols: Map<string, RawColumn>): ContentStatus {
  const statusValues = item.column_values.filter((cv) => cv.type === 'status' && cvText(cv))
  const preferred = statusValues.find((cv) => /status|situa|etapa/i.test(cols.get(cv.id)?.title ?? '')) ?? statusValues[0]
  return preferred ? mapStatus(cvText(preferred)) : 'em-producao'
}

const THEME_TITLE = /tema|assunto|t[óo]pico/i

function slug(text: string): string {
  return fold(text).replace(/\s+/g, '-')
}

const YT_ID = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/

function youtubeThumbnail(item: RawItem): string | null {
  for (const cv of item.column_values) {
    const m = YT_ID.exec(`${cv.text ?? ''} ${cv.value ?? ''}`)
    if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`
  }
  return null
}

interface BaseContent {
  title: string
  description: string
  bodyMarkdown: string
  status: ContentStatus
  themeLabels: string[]
  metadata: MetaField[]
}

/** Extrai os campos genéricos de um item a partir do schema real (tipos e títulos das colunas), sem IDs fixos. */
function readItem(item: RawItem, board: RawBoard): BaseContent {
  const cols = columnMap(board)
  const metadata: MetaField[] = []
  const themeLabels: string[] = []
  const bodyParts: string[] = []
  let description = ''

  const longTexts = item.column_values.filter((cv) => cv.type === 'long_text' && cvText(cv))
  const descCol = longTexts.find((cv) => /descri|resumo|sobre|objetivo|ementa/i.test(cols.get(cv.id)?.title ?? ''))
  if (descCol) description = cvText(descCol)

  for (const cv of item.column_values) {
    const column = cols.get(cv.id)
    const text = cvText(cv)
    if (!column || !text) continue
    if (cv.type === 'subtasks' || cv.type === 'subitems') continue
    if (THEME_TITLE.test(column.title)) {
      themeLabels.push(...text.split(/[,;]/).map((t) => t.trim()).filter(Boolean))
    }
    if (cv.type === 'long_text') {
      if (cv !== descCol) bodyParts.push(`## ${column.title}\n\n${text}`)
      continue
    }
    metadata.push({ label: column.title, value: text.length > 400 ? `${text.slice(0, 397)}…` : text })
  }

  return {
    title: item.name.trim() || 'Sem título',
    description,
    bodyMarkdown: bodyParts.join('\n\n'),
    status: pickStatus(item, cols),
    themeLabels,
    metadata,
  }
}

/** Constrói o conteúdo normalizado de UM item (usado no grafo completo e nas respostas das mutations). */
export function buildContent(type: NodeTypeDef, item: RawItem, board: RawBoard): { content: Content; themeLabels: string[] } {
  const base = readItem(item, board)
  const metadata = [...base.metadata]
  if (item.group?.title && item.group.title !== 'Group Title' && board.groups.length > 1) {
    metadata.unshift({ label: 'Grupo na monday', value: item.group.title })
  }
  const content: Content = {
    id: `${type.prefix}:${item.id}`,
    title: base.title,
    type: type.slug,
    description: base.description,
    bodyMarkdown: base.bodyMarkdown,
    themes: [],
    status: base.status,
    collectionId: null,
    thumbnailPath: type.slug === 'youtube' ? youtubeThumbnail(item) : null,
    isMock: false,
    source: 'monday',
    sourceIds: [item.id],
    sourceUrl: item.url ?? undefined,
    normalizedKey: fold(base.title),
    metadata,
  }
  return { content, themeLabels: base.themeLabels }
}

/** Ids (da monday) ligados por uma coluna Connect Boards de um item. */
export function relationIds(item: RawItem, columnId: string): string[] {
  const cv = item.column_values.find((c) => c.id === columnId)
  return cv ? linkedIds(cv) : []
}

export function themeOf(label: string): Theme {
  return { id: slug(label), label }
}

/* ------------------------------------------------------------------ montagem */

const PALETTE = ['#a8d879', '#7cb8ef', '#ebc17a', '#c59bf0', '#f0a07c', '#7cdfd0', '#e88fb8', '#9fb3d9']

interface Draft {
  content: Content
  /** Rótulos de tema originais (viram `themes` ao final). */
  themeLabels: string[]
}

export function normalizeMondayGraphData(raw: RawBoards, schema: SchemaPayload, now: Date = new Date()): GraphPayload {
  const warnings: string[] = []
  const drafts = new Map<string, Draft>()
  const relations = new Map<string, Relation>()
  const typeBySlug = new Map(schema.nodeTypes.map((t) => [t.slug, t]))
  const activeTypes = schema.nodeTypes.filter((t) => t.active && raw[t.slug])
  for (const t of schema.nodeTypes) if (t.active && !raw[t.slug]) warnings.push(`O board do tipo "${t.name}" não pôde ser lido.`)

  /* ---- Nós: um por item de cada board ---- */
  const nodeOfItem = new Map<string, { id: string; slug: string }>()
  for (const type of activeTypes) {
    const board = raw[type.slug]
    for (const item of board.items) {
      const { content, themeLabels } = buildContent(type, item, board)
      nodeOfItem.set(item.id, { id: content.id, slug: type.slug })
      drafts.set(content.id, { content, themeLabels })
    }
  }

  /* ---- Arestas: pares lidos dos dois lados da coluna e deduplicados ---- */
  const stats: Record<string, { raw: number; unique: number }> = {}
  let ignored = 0
  const connections = schema.connections.filter((c) => c.active && typeBySlug.get(c.source)?.active && typeBySlug.get(c.target)?.active)
  for (const conn of connections) {
    stats[conn.id] = { raw: 0, unique: 0 }
    const add = (sourceNode: string, targetNode: string) => {
      stats[conn.id].raw++
      const id = `rel:${conn.id}:${sourceNode}>${targetNode}`
      if (relations.has(id)) return
      relations.set(id, { id, source: sourceNode, target: targetNode, type: conn.id, relationSource: 'monday' })
      stats[conn.id].unique++
    }
    readConnection(raw, conn, nodeOfItem, add, () => ignored++)
  }

  /* ---- Temas ---- */
  const themeById = new Map<string, Theme>()
  for (const d of drafts.values()) {
    d.content.themes = [
      ...new Set(
        d.themeLabels.map((label) => {
          const id = slug(label)
          if (!themeById.has(id)) themeById.set(id, { id, label })
          return id
        }),
      ),
    ]
  }
  const themes = [...themeById.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))

  /* ---- Conjuntos: componentes conexos (conteúdos ligados ficam juntos) ---- */
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    while (parent.get(x) !== r) {
      const n = parent.get(x)!
      parent.set(x, r)
      x = n
    }
    return r
  }
  for (const id of drafts.keys()) parent.set(id, id)
  for (const r of relations.values()) {
    const a = find(r.source)
    const b = find(r.target)
    if (a !== b) parent.set(a, b)
  }
  const components = new Map<string, string[]>()
  for (const id of drafts.keys()) components.set(find(id), [...(components.get(find(id)) ?? []), id])
  const degree = new Map<string, number>()
  for (const r of relations.values()) {
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1)
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1)
  }
  // Tipos que são "pai" em alguma hierarquia (ex.: infoproduto) dão nome ao conjunto.
  const parentTypes = new Set(connections.filter((c) => c.nature === 'hierarchy').map((c) => c.source))

  const collections: Collection[] = []
  let colorIndex = 0
  const assign = (ids: string[], name: string, id: string) => {
    const color = PALETTE[colorIndex++ % PALETTE.length]
    collections.push({ id, name, color })
    for (const nodeId of ids) drafts.get(nodeId)!.content.collectionId = id
  }
  const isolatedByType = new Map<string, string[]>()
  let n = 0
  for (const ids of [...components.values()].sort((a, b) => b.length - a.length)) {
    if (ids.length === 1) {
      const t = drafts.get(ids[0])!.content.type
      isolatedByType.set(t, [...(isolatedByType.get(t) ?? []), ids[0]])
      continue
    }
    const byDegree = [...ids].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
    const hubs = byDegree.filter((id) => parentTypes.has(drafts.get(id)!.content.type))
    const named = (hubs.length ? hubs : byDegree).slice(0, 2).map((id) => drafts.get(id)!.content.title)
    const extra = (hubs.length ? hubs : byDegree).length - named.length
    assign(ids, extra > 0 ? `${named.join(' · ')} +${extra}` : named.join(' · '), `c-${n++}`)
  }
  for (const [slugOfType, ids] of isolatedByType) {
    assign(ids, `${typeBySlug.get(slugOfType)?.plural ?? slugOfType} · sem conexões`, `c-isolados-${slugOfType}`)
  }

  const boards = activeTypes.map((t) => ({ key: t.slug, id: raw[t.slug].id, name: raw[t.slug].name, items: raw[t.slug].items.length }))
  const explicit = relations.size

  return {
    contents: [...drafts.values()].map((d) => d.content),
    relations: [...relations.values()],
    collections,
    themes,
    schema,
    meta: {
      fetchedAt: now.toISOString(),
      boards,
      explicitRelations: explicit,
      relationStats: { byConnection: stats, ignored },
      inferredRelations: 0,
      mergedLessons: 0,
      warnings,
    },
  }
}

/**
 * Lê os pares (origem, destino) de uma conexão: da coluna que guarda a ligação e da coluna refletida. Cada par vira um nó de
 * origem e um de destino; ids que não pertencem ao tipo esperado são ignorados (nunca se compara por nome).
 */
function readConnection(
  raw: RawBoards,
  conn: ConnectionDef,
  nodeOfItem: Map<string, { id: string; slug: string }>,
  add: (source: string, target: string) => void,
  ignore: () => void,
) {
  const storedSlug = conn.storedOn === 'source' ? conn.source : conn.target
  const otherSlug = conn.storedOn === 'source' ? conn.target : conn.source
  const read = (boardSlug: string, columnId: string, expect: string, orient: (self: string, other: string) => void) => {
    for (const item of raw[boardSlug]?.items ?? []) {
      const self = nodeOfItem.get(item.id)
      if (!self) continue
      for (const linked of relationIds(item, columnId)) {
        const other = nodeOfItem.get(linked)
        if (!other || other.slug !== expect) {
          ignore()
          continue
        }
        orient(self.id, other.id)
      }
    }
  }
  // Coluna principal: o item guarda os itens do outro lado.
  read(storedSlug, conn.columnId, otherSlug, (self, other) => (conn.storedOn === 'source' ? add(self, other) : add(other, self)))
  // Coluna refletida: o item do outro lado guarda os itens de quem guarda a principal.
  if (conn.reflectionColumnId) {
    read(otherSlug, conn.reflectionColumnId, storedSlug, (self, other) => (conn.storedOn === 'source' ? add(other, self) : add(self, other)))
  }
}
