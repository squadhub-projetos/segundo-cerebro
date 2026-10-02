/**
 * Tipos de conteúdo. O conjunto é aberto a novas camadas: o modelo não assume níveis fixos.
 * Legados da demonstração: criativo, pagina, curso. Modelo live: infoproduto, aula, youtube.
 */
export type ContentType = 'criativo' | 'pagina' | 'curso' | 'aula' | 'infoproduto' | 'youtube'
export type ContentStatus = 'publicado' | 'finalizado' | 'em-producao'
export type RelationType = 'direciona-para' | 'apresenta' | 'contem' | 'contem-aula' | 'divulga'

/** Origem de um conteúdo. */
export type ContentSource = 'mock' | 'monday' | 'local'

/** Origem de uma relação: explícita na monday, inferida (temporária) ou criada localmente na interface. */
export type RelationSource = 'mock' | 'monday' | 'inferred' | 'local'

/** Campo de metadado exibido no painel (rótulo e valor vindos da origem). */
export interface MetaField {
  label: string
  value: string
}

export interface Content {
  id: string
  title: string
  type: ContentType
  description: string
  bodyMarkdown: string
  themes: string[]
  status: ContentStatus
  /** Conjunto temático. Null para conteúdos criados sem vínculo. */
  collectionId: string | null
  /** Caminho relativo à pasta public/referencias. Null usa a capa de fallback. */
  thumbnailPath: string | null
  isMock: boolean
  /** De onde veio o conteúdo (ausente = mock/local legado). */
  source?: ContentSource
  /** IDs dos itens de origem (monday). Uma aula deduplicada pode ter vários. */
  sourceIds?: string[]
  /** Link para abrir o item na origem. */
  sourceUrl?: string
  /** Chave normalizada usada na deduplicação. */
  normalizedKey?: string
  /** Metadados da origem, na ordem do quadro. */
  metadata?: MetaField[]
}

export interface Relation {
  id: string
  source: string
  target: string
  type: RelationType
  relationSource?: RelationSource
}

export interface Theme {
  id: string
  label: string
}

export interface Collection {
  id: string
  name: string
  color: string
}

export interface Position {
  x: number
  y: number
}

export type Positions = Record<string, Position>

/** Estado persistido no localStorage. */
export interface AppData {
  contents: Content[]
  relations: Relation[]
  positions: Positions
  /** IDs de nós posicionados à mão pelo usuário (peso de fixação maior no layout automático). */
  pinned: string[]
}

export interface Filters {
  query: string
  types: ContentType[]
  themes: string[]
  statuses: ContentStatus[]
}

/** Estado de um carregamento de dados externos. */
export interface GraphPayloadMeta {
  fetchedAt: string
  boards: { key: string; id: string; name: string; items: number }[]
  /** Relações vindas explicitamente da monday e relações inferidas (temporárias). */
  explicitRelations: number
  inferredRelations: number
  /** Aulas que consolidaram mais de um item da monday. */
  mergedLessons: number
  warnings: string[]
}

/** Formato normalizado que a interface consome, independentemente da origem (mock, monday, API própria...). */
export interface GraphPayload {
  contents: Content[]
  relations: Relation[]
  collections: Collection[]
  themes: Theme[]
  meta: GraphPayloadMeta
}
