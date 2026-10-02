import type { GraphPayload } from '../../types'
import { DEMO_COLLECTIONS, DEMO_THEMES, buildDemoData } from '../../lib/mock'

/** Demonstração (pacote mock) no formato normalizado. Usada como fallback de desenvolvimento. */
export function buildDemoPayload(): GraphPayload {
  const demo = buildDemoData()
  return {
    contents: demo.contents.map((c) => ({ ...c, source: 'mock' as const })),
    relations: demo.relations.map((r) => ({ ...r, relationSource: 'mock' as const })),
    collections: DEMO_COLLECTIONS,
    themes: DEMO_THEMES,
    meta: {
      fetchedAt: new Date().toISOString(),
      boards: [],
      explicitRelations: 0,
      inferredRelations: 0,
      mergedLessons: 0,
      warnings: ['Dados de demonstração (fictícios).'],
    },
  }
}
