/**
 * Modelo do schema do Segundo Cérebro: tipos de conteúdo (cada um guardado em UM board da monday) e tipos de conexão
 * (cada um guardado em UMA coluna Connect Boards). Persistido na monday (boards "SC | Estrutura" e
 * "SC | Relações", isolados pela coluna Brain ID) e lido pelo servidor; o navegador só consome este formato.
 */

export type ConnectionNature = 'hierarchy' | 'association'

/** Quantos itens cada lado pode ligar: um-para-um, um-para-muitos (origem → vários destinos) ou muitos-para-muitos. */
export type Cardinality = 'one-one' | 'one-many' | 'many-many'

export interface NodeTypeDef {
  /** Id estável do tipo (usado em `Content.type`). */
  slug: string
  brainId: string
  /** Nome no singular (também o rótulo do tipo). */
  name: string
  plural: string
  description: string
  /** Nome do ícone (lucide) conhecido por `src/lib/icons.ts`. */
  icon: string
  /** Cor de identidade (#rrggbb). */
  accent: string
  /** `core`: tipos que já existiam e não podem ser removidos; `custom`: criados pela plataforma. */
  role: 'core' | 'custom'
  active: boolean
  boardId: string
  boardName?: string
  workspaceId: string
  folderId: string
  /** Coluna de descrição (long text) do board, quando existe. */
  descriptionColumnId?: string
  /** Prefixo do id dos nós: `<prefixo>:<id do item na monday>`. */
  prefix: string
  /** Id do item no board de registry (ausente quando ainda não registrado). */
  registryItemId?: string
}

export interface ConnectionDef {
  /** Id estável da regra; é o `Relation.type` no grafo. */
  id: string
  brainId: string
  name: string
  /** Rótulo da origem para o destino ("contém"). */
  label: string
  /** Rótulo no sentido inverso ("usada em"). */
  reverseLabel: string
  /** Slugs dos tipos. Podem ser iguais (relação dentro do mesmo board). */
  source: string
  target: string
  nature: ConnectionNature
  cardinality: Cardinality
  /** Em qual lado fica a coluna que guarda a ligação. */
  storedOn: 'source' | 'target'
  columnId: string
  reflectionColumnId?: string
  description?: string
  active: boolean
  registryItemId?: string
}

export interface SchemaLocation {
  workspace: { id: string; name: string } | null
  folder: { id: string; name: string } | null
}

export interface SchemaPayload extends SchemaLocation {
  /** `false`: os boards de registry ainda não existem; vale a definição embutida dos tipos núcleo. */
  initialized: boolean
  /** Endereço da conta (https://<conta>.monday.com), para abrir boards e itens. */
  baseUrl: string
  nodeTypes: NodeTypeDef[]
  connections: ConnectionDef[]
  registryBoards: { nodeTypes: string; connections: string } | null
  structure: {
    /** Alterações estruturais habilitadas neste ambiente. */
    enabled: boolean
    /** O servidor exige chave de administração (SCHEMA_ADMIN_KEY). */
    keyRequired: boolean
  }
}
