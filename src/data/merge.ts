import type { AppData, Content, GraphPayload, Positions, Relation } from '../types'
import { computeLayout } from '../lib/layout'
import { setTaxonomy } from '../lib/mock'
import { placeNode } from '../lib/spatial'
import { setSelectableTypes } from '../components/meta'

/**
 * Camada LOCAL por cima dos dados da monday: apenas layout (posições e fixações por id da monday). Conteúdos, relações e
 * coleções vêm sempre da monday e nunca são restaurados do navegador.
 */
export interface LiveOverlay {
  version: 2
  positions: Positions
  pinned: string[]
}

export const isRemote = (c: Content) => c.source === 'monday'
export const isRemoteRelation = (r: Relation) => r.relationSource === 'monday' || r.relationSource === 'inferred'

export function overlayOf(data: AppData): LiveOverlay {
  return {
    version: 2,
    positions: data.positions,
    pinned: data.pinned,
  }
}

export function emptyData(): AppData {
  return { contents: [], relations: [], positions: {}, pinned: [] }
}

/** Junta os dados remotos com a camada local e garante posição para todos os nós. */
export function mergeRemote(payload: GraphPayload, overlay: LiveOverlay | null): AppData {
  setTaxonomy(payload.themes, payload.collections)
  setSelectableTypes(['infoproduto', 'aula', 'youtube'])

  const contents = payload.contents
  const relations: Relation[] = [...payload.relations]
  const ids = new Set(contents.map((c) => c.id))

  const positions: Positions = {}
  for (const [id, p] of Object.entries(overlay?.positions ?? {})) if (ids.has(id)) positions[id] = p
  const pinned = (overlay?.pinned ?? []).filter((id) => ids.has(id))

  const missing = contents.filter((c) => !positions[c.id])
  if (missing.length === contents.length) {
    // Primeira abertura: composição completa.
    return { contents, relations, positions: computeLayout(contents, relations), pinned }
  }
  // Atualização: só os nós novos são posicionados (perto dos vizinhos); o resto da composição do usuário é preservada.
  const placed: Content[] = contents.filter((c) => positions[c.id])
  for (const c of missing) {
    const own = relations.filter((r) => r.source === c.id || r.target === c.id)
    positions[c.id] = placeNode({ contents: placed, relations, positions, pinned: new Set(pinned) }, { content: c, relations: own }).position
    placed.push(c)
  }
  return { contents, relations, positions, pinned }
}
