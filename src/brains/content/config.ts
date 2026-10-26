import { BookOpen, Clapperboard, Library, Package } from 'lucide-react'
import { brainCatalogEntry } from '../catalog'
import type { BrainConfig } from '../types'

/** Cérebro de Conteúdo: o único habilitado hoje (dados reais da monday). */
export const contentBrain: BrainConfig = {
  ...brainCatalogEntry('content')!,
  Icon: Library,
  enabled: true,
  dataSource: { kind: 'monday', label: 'monday.com' },
  labels: { newItem: 'Novo conteúdo' },
  nodeTypes: [
    {
      id: 'infoproduto',
      label: 'Infoproduto',
      plural: 'Infoprodutos',
      description: 'Produto educacional da SquadHub. É o núcleo: reúne aulas e recebe vídeos.',
      origin: 'Quadro Controle de Infoprodutos (monday.com)',
      accent: '#3ec8f5',
      Icon: Package,
    },
    {
      id: 'aula',
      label: 'Aula',
      plural: 'Aulas',
      description: 'Uma aula gravada. Pode ser usada em mais de um infoproduto e continua sendo um único item.',
      origin: 'Quadro Controle de Aulas (monday.com)',
      accent: '#9aa9ff',
      Icon: BookOpen,
    },
    {
      id: 'youtube',
      label: 'YouTube',
      plural: 'Vídeos do YouTube',
      description: 'Vídeo do canal. Pode apontar para um infoproduto; sem relação, continua visível no mapa.',
      origin: 'Quadro Controle YouTube (monday.com)',
      accent: '#ff8f8f',
      Icon: Clapperboard,
    },
  ],
  connections: [
    {
      id: 'infoproduto-aula',
      relationType: 'contem-aula',
      from: 'infoproduto',
      to: 'aula',
      kind: 'hierarchy',
      label: 'contém',
      reverseLabel: 'usada em',
      description: 'O infoproduto contém as aulas. Uma aula pode ser usada em vários infoprodutos.',
      storage: 'Coluna de conexão do quadro Controle de Aulas (lado da aula).',
    },
    {
      id: 'youtube-infoproduto',
      relationType: 'divulga',
      from: 'youtube',
      to: 'infoproduto',
      kind: 'association',
      label: 'direciona para',
      reverseLabel: 'recebe vídeos de',
      description: 'O vídeo direciona o público para um infoproduto. Nunca é inferido por tema.',
      storage: 'Coluna de conexão do quadro Controle YouTube (a monday reflete no infoproduto).',
    },
  ],
}
