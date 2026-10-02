import grafo from '../data/grafo-completo.json'
import type { AppData, Collection, Content, ContentStatus, ContentType, Relation, RelationType, Theme } from '../types'
import { computeLayout } from './layout'

export const EXPECTED_CONTENTS = 30
export const EXPECTED_RELATIONS = 27

/**
 * Taxonomia em uso (temas e conjuntos). Começa com a da demonstração; com dados live é substituída por `setTaxonomy`
 * antes de o estado ser publicado. (Binding exportado: quem importa vê o valor atual.)
 */
export let THEMES: Theme[] = grafo.themes
export let COLLECTIONS: Collection[] = grafo.collections
export function setTaxonomy(themes: Theme[], collections: Collection[]) {
  THEMES = themes
  COLLECTIONS = collections
}
export const DEMO_THEMES: Theme[] = grafo.themes
export const DEMO_COLLECTIONS: Collection[] = grafo.collections

const demoContents: Content[] = grafo.contents.map((c) => ({
  id: c.id,
  title: c.title,
  type: c.type as ContentType,
  description: c.description,
  bodyMarkdown: c.bodyMarkdown,
  themes: [...c.themes],
  status: c.status as ContentStatus,
  collectionId: c.collectionId,
  thumbnailPath: c.thumbnailPath,
  isMock: true,
}))

const demoRelations: Relation[] = grafo.relations.map((r) => ({
  id: r.id,
  source: r.source,
  target: r.target,
  type: r.type as RelationType,
}))

/** Valida o pacote antes de renderizar. Retorna uma mensagem de erro ou null. */
export function validateDemo(): string | null {
  if (demoContents.length !== EXPECTED_CONTENTS) {
    return `Esperados ${EXPECTED_CONTENTS} conteúdos, encontrados ${demoContents.length}.`
  }
  if (demoRelations.length !== EXPECTED_RELATIONS) {
    return `Esperadas ${EXPECTED_RELATIONS} relações, encontradas ${demoRelations.length}.`
  }
  const ids = new Set(demoContents.map((c) => c.id))
  if (ids.size !== demoContents.length) return 'Há IDs de conteúdo duplicados no pacote.'
  const broken = demoRelations.find((r) => !ids.has(r.source) || !ids.has(r.target))
  if (broken) return `A relação ${broken.id} aponta para um ID inexistente.`
  return null
}

export function buildDemoData(): AppData {
  const contents = demoContents.map((c) => ({ ...c, themes: [...c.themes] }))
  const relations = demoRelations.map((r) => ({ ...r }))
  return { contents, relations, positions: computeLayout(contents, relations), pinned: [] }
}
