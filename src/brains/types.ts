import type { LucideIcon } from 'lucide-react'

/**
 * Um "cérebro" é um contexto isolado do Segundo Cérebro (Conteúdo, Projetos, Marketing...). A configuração é DECLARATIVA e só
 * descreve o que a interface mostra: tipos de nó, conexões permitidas e origem dos dados. Quem persiste (e valida de verdade)
 * continua sendo o servidor; esta configuração nunca é uma regra de segurança.
 */

/** Hierarquia = composição (pai contém filho). Associação = ligação semântica livre entre dois tipos. */
export type ConnectionKind = 'hierarchy' | 'association'

export interface BrainNodeType {
  /** Id do tipo (o mesmo usado em `Content.type`). */
  id: string
  label: string
  plural: string
  description: string
  /** De onde vêm os itens (texto informativo). */
  origin: string
  /** Cor de identidade do tipo (acento discreto). */
  accent: string
  Icon: LucideIcon
  /** Board da monday que guarda os itens deste tipo (quando existe). */
  boardId?: string
  boardName?: string
  /** `core`: tipos que já existiam; `custom`: criados pela plataforma. */
  role?: 'core' | 'custom'
}

export interface BrainConnection {
  id: string
  /** Id do `RelationType` usado nos dados (ex.: 'contem-aula'). */
  relationType: string
  from: string
  to: string
  kind: ConnectionKind
  /** Rótulo na direção from → to ("contém"). */
  label: string
  /** Rótulo na direção inversa ("usada em"). */
  reverseLabel: string
  description: string
  /** Como a ligação é guardada (texto informativo; o servidor é a autoridade). */
  storage: string
  name?: string
  cardinality?: 'one-one' | 'one-many' | 'many-many'
  storedOn?: 'source' | 'target'
  columnId?: string
  reflectionColumnId?: string
}

export interface BrainDataSource {
  /** `none`: ainda não existe fonte de dados para este cérebro. */
  kind: 'monday' | 'none'
  label: string
}

export interface BrainConfig {
  id: string
  name: string
  /** Descrição completa. */
  description: string
  /** Linha curta exibida no seletor. */
  tagline: string
  Icon: LucideIcon
  /** Só cérebros habilitados podem ser ativados; os demais aparecem como "Em breve". */
  enabled: boolean
  dataSource: BrainDataSource
  nodeTypes: BrainNodeType[]
  /** Conexões permitidas. As de `kind: 'hierarchy'` formam as regras de hierarquia (from = pai, to = filho). */
  connections: BrainConnection[]
  labels: {
    /** Texto da ação de criar ("Novo conteúdo"). */
    newItem: string
  }
}

export type ViewId = 'map' | 'connections'
