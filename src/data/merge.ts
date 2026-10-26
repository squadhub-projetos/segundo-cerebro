import type { AppData, Content, GraphPayload, Positions, Relation } from '../types'
import { computeLayout } from '../lib/layout'
import { setTaxonomy } from '../lib/mock'
import { placeNode } from '../lib/spatial'
import { applySchema } from '../lib/schemaRuntime'

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
  applySchema(payload.schema ?? null)

  const contents = payload.contents
  const relations: Relation[] = [...payload.relations]
  const ids = new Set(contents.map((c) => c.id))

  const positions: Positions = {}
  for (const [id, p] of Object.entries(overlay?.positions ?? {})) if (ids.has(id)) positions[id] = p
  const pinned = (overlay?.pinned ?? []).filter((id) => ids.has(id))

  // Cada cérebro tem a sua própria composição: o layout e a colocação de nós novos consideram só os nós do mesmo cérebro
  // (as posições nunca se misturam entre cérebros).
  const brainOfType = new Map((payload.schema?.nodeTypes ?? []).map((t) => [t.slug, t.brainId]))
  const groups = new Map<string, Content[]>()
  for (const c of contents) groups.set(brainOfType.get(c.type) ?? '', [...(groups.get(brainOfType.get(c.type) ?? '') ?? []), c])
  for (const group of groups.values()) {
    const groupIds = new Set(group.map((c) => c.id))
    const groupRelations = relations.filter((r) => groupIds.has(r.source) && groupIds.has(r.target))
    const missing = group.filter((c) => !positions[c.id])
    if (missing.length === 0) continue
    if (missing.length === group.length) {
      // Primeira abertura deste cérebro: composição completa.
      Object.assign(positions, computeLayout(group, groupRelations))
      continue
    }
    // Atualização: só os nós novos são posicionados (perto dos vizinhos); o resto da composição do usuário é preservada.
    const placed: Content[] = group.filter((c) => positions[c.id])
    for (const c of missing) {
      const own = groupRelations.filter((r) => r.source === c.id || r.target === c.id)
      positions[c.id] = placeNode({ contents: placed, relations: groupRelations, positions, pinned: new Set(pinned) }, { content: c, relations: own }).position
      placed.push(c)
    }
  }
  return { contents, relations, positions, pinned }
}
