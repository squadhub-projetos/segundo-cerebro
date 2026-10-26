import type { Cardinality, ConnectionNature } from '../../types/schema'

/**
 * Definição dos tipos e conexões NÚCLEO do cérebro Conteúdo (os boards já existem na monday). Dados puros, sem React: o
 * servidor usa isto para registrar os tipos existentes (sem recriar boards) e como padrão enquanto o registry não existe.
 * Os ids das colunas de conexão não ficam aqui: são descobertos no schema real dos boards.
 */

export type CoreBoardKey = 'infoproducts' | 'courses' | 'youtube'

export interface CoreNodeType {
  slug: string
  name: string
  plural: string
  description: string
  icon: string
  accent: string
  prefix: string
  boardKey: CoreBoardKey
  descriptionColumnId?: string
}

export interface CoreConnection {
  id: string
  name: string
  label: string
  reverseLabel: string
  source: string
  target: string
  nature: ConnectionNature
  cardinality: Cardinality
  storedOn: 'source' | 'target'
  description: string
}

export const CONTENT_BRAIN_ID = 'content'

export const CORE_NODE_TYPES: CoreNodeType[] = [
  {
    slug: 'infoproduto',
    name: 'Infoproduto',
    plural: 'Infoprodutos',
    description: 'Produto educacional da SquadHub. É o núcleo: reúne aulas e recebe vídeos.',
    icon: 'package',
    accent: '#3ec8f5',
    prefix: 'info',
    boardKey: 'infoproducts',
  },
  {
    slug: 'aula',
    name: 'Aula',
    plural: 'Aulas',
    description: 'Uma aula gravada. Pode ser usada em mais de um infoproduto e continua sendo um único item.',
    icon: 'book-open',
    accent: '#9aa9ff',
    prefix: 'lesson',
    boardKey: 'courses',
    descriptionColumnId: 'long_text_mm7rh2ga',
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    plural: 'Vídeos do YouTube',
    description: 'Vídeo do canal. Pode apontar para um infoproduto; sem relação, continua visível no mapa.',
    icon: 'clapperboard',
    accent: '#ff8f8f',
    prefix: 'yt',
    boardKey: 'youtube',
  },
]

export const CORE_CONNECTIONS: CoreConnection[] = [
  {
    id: 'contem-aula',
    name: 'Infoproduto contém Aula',
    label: 'contém',
    reverseLabel: 'usada em',
    source: 'infoproduto',
    target: 'aula',
    nature: 'hierarchy',
    cardinality: 'many-many',
    storedOn: 'target',
    description: 'O infoproduto contém as aulas. Uma aula pode ser usada em vários infoprodutos.',
  },
  {
    id: 'divulga',
    name: 'YouTube direciona para Infoproduto',
    label: 'direciona para',
    reverseLabel: 'recebe vídeos de',
    source: 'youtube',
    target: 'infoproduto',
    nature: 'association',
    cardinality: 'many-many',
    storedOn: 'source',
    description: 'O vídeo direciona o público para um infoproduto. Nunca é inferido por tema.',
  },
]
