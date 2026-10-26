/**
 * Catálogo dos cérebros (dados puros, sem React): usado pelo servidor (nome do cérebro nos boards, validação do `brainId`) e
 * pelo cliente (`registry.ts`). Cada cérebro nasce VAZIO: seus tipos e conexões são criados pela interface e guardados na
 * monday (boards "SC | Estrutura" e "SC | Relações"), isolados pela coluna Brain ID.
 */

export interface BrainCatalogEntry {
  id: string
  name: string
  description: string
  tagline: string
}

export const BRAIN_CATALOG: readonly BrainCatalogEntry[] = [
  {
    id: 'content',
    name: 'Conteúdo',
    description: 'Cursos, aulas e vídeos do YouTube da SquadHub e como eles se conectam.',
    tagline: 'Cursos, aulas e YouTube',
  },
  {
    id: 'projects',
    name: 'Projetos',
    description: 'Conhecimento e soluções desenvolvidas nos projetos da SquadHub.',
    tagline: 'Projetos, frentes e soluções',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Mapa de ativos, campanhas, produtos e estratégias de marketing.',
    tagline: 'Produtos, campanhas e ativos',
  },
]

export const brainCatalogEntry = (id: string): BrainCatalogEntry | undefined => BRAIN_CATALOG.find((b) => b.id === id)
