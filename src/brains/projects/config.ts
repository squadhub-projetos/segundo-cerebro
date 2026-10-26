import { FolderKanban } from 'lucide-react'
import { brainCatalogEntry } from '../catalog'
import type { BrainConfig } from '../types'

/**
 * Cérebro de Projetos: começa VAZIO. Os tipos (ex.: Cliente, Projeto, Frente) e as conexões são criados pela interface
 * (tela Conexões) e guardados na monday com brainId = "projects"; nada daqui precisa mudar para isso.
 */
export const projectsBrain: BrainConfig = {
  ...brainCatalogEntry('projects')!,
  Icon: FolderKanban,
  enabled: true,
  dataSource: { kind: 'monday', label: 'monday.com' },
  labels: { newItem: 'Novo item' },
  nodeTypes: [],
  connections: [],
}
