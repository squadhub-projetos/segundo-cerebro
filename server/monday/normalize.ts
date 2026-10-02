import type { Collection, Content, ContentStatus, GraphPayload, MetaField, Relation, RelationType, Theme } from '../../src/types/index.js'
import type { BoardKey, RawBoard, RawBoards, RawColumn, RawColumnValue, RawItem } from './types.js'

/**
 * Transforma os 3 quadros crus da monday no grafo normalizado que a interface consome.
 *
 *  - Controle de Infoprodutos → nós `infoproduto`
 *  - Controle de Cursos 2.0   → nós `aula` (um por item; o grupo NÃO vira nó)
 *  - YouTube                  → nós `youtube`
 *
 * Relações: colunas do tipo `board_relation` (linked items) são a ÚNICA fonte das arestas (`relationSource: 'monday'`).
 * O grupo da monday entra apenas como metadado/agrupamento visual; nunca cria relação. Cada item é um nó (sem fusão por
 * nome): uma aula ligada a vários infoprodutos continua sendo um único nó, porque é um único item.
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

function linkedIds(cv: RawColumnValue): string[] {
  if (cv.type !== 'board_relation') return []
  if (cv.linked_item_ids?.length) return cv.linked_item_ids.map(String)
  try {
    const parsed = JSON.parse(cv.value ?? 'null') as { linkedPulseIds?: { linkedPulseId: number | string }[] } | null
    return (parsed?.linkedPulseIds ?? []).map((l) => String(l.linkedPulseId))
  } catch {
    return []
  }
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

/* ------------------------------------------------------------------ montagem */

/** Prefixo do id interno por quadro (o id completo é `<prefixo>:<id do item na monday>`; itens de quadros diferentes não colidem). */
export const NODE_PREFIX: Record<BoardKey, string> = { infoproducts: 'info', courses: 'lesson', youtube: 'yt' }
const NODE_TYPE: Record<BoardKey, Content['type']> = { infoproducts: 'infoproduto', courses: 'aula', youtube: 'youtube' }

/** Constrói o conteúdo normalizado de UM item (usado no grafo completo e nas respostas das mutations). */
export function buildContent(key: BoardKey, item: RawItem, board: RawBoard): { content: Content; themeLabels: string[]; base: BaseContent } {
  const base = readItem(item, board)
  const metadata = [...base.metadata]
  if (key === 'courses' && item.group?.title) metadata.unshift({ label: 'Grupo na monday', value: item.group.title })
  if (key === 'youtube' && item.group?.title) metadata.unshift({ label: 'Grupo na monday', value: item.group.title })
  const content: Content = {
    id: `${NODE_PREFIX[key]}:${item.id}`,
    title: base.title,
    type: NODE_TYPE[key],
    description: base.description,
    bodyMarkdown: base.bodyMarkdown,
    themes: [],
    status: base.status,
    collectionId: null,
    thumbnailPath: key === 'youtube' ? youtubeThumbnail(item) : null,
    isMock: false,
    source: 'monday',
    sourceIds: [item.id],
    sourceUrl: item.url ?? undefined,
    normalizedKey: fold(base.title),
    metadata,
  }
  return { content, themeLabels: base.themeLabels, base }
}

/** Ids (da monday) ligados por uma coluna Connect Boards de um item. */
export function relationIds(item: RawItem, columnId: string): string[] {
  const cv = item.column_values.find((c) => c.id === columnId)
  return cv ? linkedIds(cv) : []
}

export function themeOf(label: string): Theme {
  return { id: slug(label), label }
}

const PALETTE = ['#a8d879', '#7cb8ef', '#ebc17a', '#c59bf0', '#f0a07c', '#7cdfd0', '#e88fb8', '#9fb3d9']

interface Draft {
  content: Content
  /** Rótulos de tema originais (viram `themes` ao final). */
  themeLabels: string[]
}

export function normalizeMondayGraphData(raw: RawBoards, now: Date = new Date()): GraphPayload {
  const warnings: string[] = []
  const drafts = new Map<string, Draft>()
  const relations = new Map<string, Relation>()
  let explicitRelations = 0
  const inferredRelations = 0

  const addRelation = (type: RelationType, source: string, target: string, relationSource: 'monday') => {
    const id = `rel:${type}:${source}>${target}`
    if (relations.has(id)) return
    relations.set(id, { id, source, target, type, relationSource })
    explicitRelations++
  }

  /* ---- Infoprodutos ---- */
  const infoNodeByItem = new Map<string, string>()
  for (const item of raw.infoproducts.items) {
    const { content, themeLabels } = buildContent('infoproducts', item, raw.infoproducts)
    infoNodeByItem.set(item.id, content.id)
    drafts.set(content.id, { content, themeLabels })
  }

  /* ---- YouTube ---- */
  const videoNodeByItem = new Map<string, string>()
  for (const item of raw.youtube.items) {
    const { content, themeLabels } = buildContent('youtube', item, raw.youtube)
    videoNodeByItem.set(item.id, content.id)
    drafts.set(content.id, { content, themeLabels })
  }

  /* ---- Aulas (um nó por item do Controle de Aulas) ---- */
  interface LessonItem {
    item: RawItem
    base: BaseContent
  }
  const lessonItems: LessonItem[] = []
  const lessonNodeByItem = new Map<string, string>()
  for (const item of raw.courses.items) {
    const { content, themeLabels, base } = buildContent('courses', item, raw.courses)
    lessonItems.push({ item, base })
    lessonNodeByItem.set(item.id, content.id)
    drafts.set(content.id, { content, themeLabels })
  }

  /* ---- Relações explícitas (colunas Connect Boards) ---- */
  const infoIds = new Set(infoNodeByItem.keys())
  const lessonIds = new Set(lessonNodeByItem.keys())
  const videoIds = new Set(videoNodeByItem.keys())

  for (const item of raw.infoproducts.items) {
    for (const cv of item.column_values) {
      for (const target of linkedIds(cv)) {
        if (lessonIds.has(target)) {
          addRelation('contem-aula', infoNodeByItem.get(item.id)!, lessonNodeByItem.get(target)!, 'monday')
        } else if (videoIds.has(target)) {
          addRelation('divulga', videoNodeByItem.get(target)!, infoNodeByItem.get(item.id)!, 'monday')
        }
      }
    }
  }
  for (const item of raw.courses.items) {
    for (const cv of item.column_values) {
      for (const target of linkedIds(cv)) {
        if (infoIds.has(target)) {
          addRelation('contem-aula', infoNodeByItem.get(target)!, lessonNodeByItem.get(item.id)!, 'monday')
        }
      }
    }
  }
  for (const item of raw.youtube.items) {
    for (const cv of item.column_values) {
      for (const target of linkedIds(cv)) {
        if (infoIds.has(target)) addRelation('divulga', videoNodeByItem.get(item.id)!, infoNodeByItem.get(target)!, 'monday')
      }
    }
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

  /* ---- Conjuntos: componentes conexos do grafo (infoprodutos que compartilham aulas ficam juntos) ---- */
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
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const id of drafts.keys()) parent.set(id, id)
  for (const r of relations.values()) union(r.source, r.target)
  const components = new Map<string, string[]>()
  for (const id of drafts.keys()) components.set(find(id), [...(components.get(find(id)) ?? []), id])
  const degree = new Map<string, number>()
  for (const r of relations.values()) {
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1)
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1)
  }

  const collections: Collection[] = []
  const looseVideos: string[] = []
  const isolated: string[] = []
  let colorIndex = 0
  const assign = (ids: string[], name: string, id: string) => {
    const color = PALETTE[colorIndex++ % PALETTE.length]
    collections.push({ id, name, color })
    for (const nodeId of ids) drafts.get(nodeId)!.content.collectionId = id
  }
  let n = 0
  for (const ids of [...components.values()].sort((a, b) => b.length - a.length)) {
    const infos = ids.filter((id) => drafts.get(id)!.content.type === 'infoproduto').sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
    if (ids.length === 1 && drafts.get(ids[0])!.content.type === 'youtube') {
      looseVideos.push(ids[0])
      continue
    }
    if (ids.length === 1) {
      // Infoprodutos/aulas sem nenhuma relação: ficam juntos numa área própria (o grupo da monday não vira cluster).
      isolated.push(ids[0])
      continue
    }
    if (infos.length > 0) {
      const names = infos.slice(0, 2).map((id) => drafts.get(id)!.content.title)
      assign(ids, infos.length > 2 ? `${names.join(' · ')} +${infos.length - 2}` : names.join(' · '), `c-${n++}`)
    } else {
      assign(ids, 'Conteúdos relacionados', `c-${n++}`)
    }
  }
  if (isolated.length > 0) assign(isolated, 'Sem conexões', 'c-isolados')
  if (looseVideos.length > 0) assign(looseVideos, 'YouTube · sem infoproduto', 'c-youtube-solto')

  const boards = (['infoproducts', 'courses', 'youtube'] as const).map((key) => ({
    key,
    id: raw[key].id,
    name: raw[key].name,
    items: raw[key].items.length,
  }))

  return {
    contents: [...drafts.values()].map((d) => d.content),
    relations: [...relations.values()],
    collections,
    themes,
    meta: { fetchedAt: now.toISOString(), boards, explicitRelations, inferredRelations, mergedLessons: 0, warnings },
  }
}
