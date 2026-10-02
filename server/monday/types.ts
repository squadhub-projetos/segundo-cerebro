/** Dados crus da monday, como a API devolve (apenas o que usamos). */
export interface RawColumn {
  id: string
  title: string
  type: string
  settings_str?: string | null
}

export interface RawGroup {
  id: string
  title: string
}

export interface RawColumnValue {
  id: string
  type: string
  text: string | null
  value: string | null
  /** BoardRelationValue */
  linked_item_ids?: string[]
  /** MirrorValue */
  display_value?: string | null
}

export interface RawItem {
  id: string
  name: string
  url?: string | null
  group: RawGroup | null
  column_values: RawColumnValue[]
}

export interface RawBoard {
  id: string
  name: string
  groups: RawGroup[]
  columns: RawColumn[]
  items: RawItem[]
}

export type BoardKey = 'infoproducts' | 'courses' | 'youtube'

export interface RawBoards {
  infoproducts: RawBoard
  courses: RawBoard
  youtube: RawBoard
}

export interface MondayConfig {
  token: string
  apiVersion: string
  boards: Record<BoardKey, string>
  cacheSeconds: number
  /** `MONDAY_WRITE_ENABLED=0` deixa a implantação somente leitura. */
  writesEnabled: boolean
  /** Grupo onde itens novos são criados (id do grupo na monday). Vazio: resolvido pelo título em `NEW_ITEM_GROUP_TITLE`. */
  newItemGroups: Record<BoardKey, string>
}
