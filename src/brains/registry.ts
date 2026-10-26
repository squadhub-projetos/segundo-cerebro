import type { BrainConfig, BrainConnection, BrainNodeType } from './types'
import { contentBrain } from './content/config'
import { marketingBrain } from './marketing/config'
import { projectsBrain } from './projects/config'

/**
 * Registro dos cérebros. Para adicionar um novo: crie `src/brains/<id>/config.ts` e inclua-o na lista abaixo.
 * Para ativá-lo: `enabled: true` e uma fonte de dados.
 */
export const BRAINS: readonly BrainConfig[] = [contentBrain, projectsBrain, marketingBrain]

export const DEFAULT_BRAIN_ID = contentBrain.id

export function findBrain(id: string | null | undefined): BrainConfig | undefined {
  return BRAINS.find((b) => b.id === id)
}

/** Id utilizável: só cérebros existentes e habilitados; qualquer outro valor cai no padrão. */
export function resolveBrainId(id: string | null | undefined): string {
  const brain = findBrain(id)
  return brain?.enabled ? brain.id : DEFAULT_BRAIN_ID
}

export function getBrain(id: string | null | undefined): BrainConfig {
  return findBrain(resolveBrainId(id)) as BrainConfig
}

export const nodeTypeIds = (brain: BrainConfig): string[] => brain.nodeTypes.map((t) => t.id)

export const nodeTypeOf = (brain: BrainConfig, id: string): BrainNodeType | undefined => brain.nodeTypes.find((t) => t.id === id)

/** Regras de hierarquia do cérebro (pai → filho). */
export const hierarchyRules = (brain: BrainConfig): BrainConnection[] => brain.connections.filter((c) => c.kind === 'hierarchy')
