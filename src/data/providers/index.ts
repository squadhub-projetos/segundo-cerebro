import type { GraphPayload } from '../../types'
import { buildDemoPayload } from './mockProvider'
import { loadMondayGraph } from './mondayProvider'

/**
 * Camada de dados: a interface consome sempre o mesmo formato normalizado (`GraphPayload`), qualquer que seja a origem
 * (demonstração, monday, API própria no futuro, banco...).
 */
export interface GraphProvider {
  id: 'mock' | 'monday'
  load(options?: { refresh?: boolean }): Promise<GraphPayload>
}

export { ProviderError } from './errors'

export const mockProvider: GraphProvider = { id: 'mock', load: async () => buildDemoPayload() }
export const mondayProvider: GraphProvider = { id: 'monday', load: (options) => loadMondayGraph(options?.refresh ?? false) }
