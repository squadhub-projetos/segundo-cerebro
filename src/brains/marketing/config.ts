import { Target } from 'lucide-react'
import { brainCatalogEntry } from '../catalog'
import type { BrainConfig } from '../types'

/**
 * Cérebro de Marketing: começa VAZIO. Os tipos (ex.: Isca, Campanha, Landing Page) e as conexões são criados pela interface
 * (tela Conexões) e guardados na monday com brainId = "marketing"; nada daqui precisa mudar para isso.
 */
export const marketingBrain: BrainConfig = {
  ...brainCatalogEntry('marketing')!,
  Icon: Target,
  enabled: true,
  dataSource: { kind: 'monday', label: 'monday.com' },
  labels: { newItem: 'Novo item' },
  nodeTypes: [],
  connections: [],
}
