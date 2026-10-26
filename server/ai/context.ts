import { fold } from '../monday/normalize.js'
import { RequestError } from '../monday/registry.js'
import { getGraph } from '../monday/graph.js'
import { brainCatalogEntry } from '../../src/brains/catalog.js'
import type { Content } from '../../src/types/index.js'
import type { BrainContext } from './types.js'

/**
 * Contexto do cérebro ativo para o assistente: schema do cérebro (tipos e conexões) e seus conteúdos/relações. Fica só no
 * servidor; o modelo recebe apenas resumos (schema, títulos, metadados curtos) e consulta o resto por tools de leitura.
 */

export async function buildContext(env: Record<string, string | undefined>, brainId: string, refresh = false): Promise<BrainContext> {
  const entry = brainCatalogEntry(brainId)
  if (!entry) throw new RequestError('Cérebro desconhecido.')
  const { payload } = await getGraph(env, refresh)
  const schema = payload.schema
  if (!schema) throw new RequestError('O schema não está disponível.')
  const types = schema.nodeTypes.filter((t) => t.brainId === brainId && t.active)
  const slugs = new Set(types.map((t) => t.slug))
  const contents = payload.contents.filter((c) => slugs.has(c.type))
  const ids = new Set(contents.map((c) => c.id))
  return {
    brainId,
    brainName: entry.name,
    schema,
    types,
    connections: schema.connections.filter((c) => c.brainId === brainId && c.active),
    contents,
    relations: payload.relations.filter((r) => ids.has(r.source) && ids.has(r.target)),
  }
}

/* ------------------------------------------------------------------ busca */

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'para', 'com', 'no', 'na', 'nos', 'nas', 'em', 'um', 'uma', 'por', 'ao', 'sobre', 'que'])

// Palavras de pedido e termos genéricos não identificam um conteúdo ("aula", "curso"...): ficam fora da busca por assunto.
const GENERIC = new Set(['aula', 'aulas', 'curso', 'cursos', 'video', 'videos', 'conteudo', 'conteudos', 'novo', 'nova', 'novos', 'novas', 'criar', 'cria', 'crie', 'quero', 'chamado', 'chamada', 'duas', 'dois', 'tres', 'aproveita', 'aproveitar', 'item', 'itens', 'qualquer', 'existe', 'existente'])

const tokens = (text: string) => fold(text).split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !GENERIC.has(t))

export interface Hit {
  id: string
  title: string
  type: string
  typeLabel: string
  summary: string
  connections: string[]
  score: number
}

export const typeLabelOf = (ctx: BrainContext, slug: string) => ctx.types.find((t) => t.slug === slug)?.name ?? slug

/** Frases curtas e humanas das conexões de um conteúdo ("contém: Aula X"). */
export function connectionsOf(ctx: BrainContext, content: Content, limit = 6): string[] {
  const byId = new Map(ctx.contents.map((c) => [c.id, c]))
  const out: string[] = []
  for (const r of ctx.relations) {
    const conn = ctx.connections.find((c) => c.id === r.type)
    if (!conn) continue
    if (r.source === content.id) out.push(`${conn.label}: ${byId.get(r.target)?.title ?? '?'}`)
    else if (r.target === content.id) out.push(`${conn.reverseLabel}: ${byId.get(r.source)?.title ?? '?'}`)
    if (out.length >= limit) break
  }
  return out
}

export const summaryOf = (c: Content): string => {
  const base = c.description?.trim() || (c.metadata ?? []).slice(0, 3).map((m) => `${m.label}: ${m.value}`).join('; ')
  return base.length > 160 ? `${base.slice(0, 157)}…` : base
}

/**
 * Busca por conteúdos existentes (sem acentos, sem diferença de caixa). Vale o título (peso maior) e, com peso menor, a
 * descrição e os metadados. Serve para encontrar duplicidade e conteúdo reaproveitável.
 */
export function searchContents(ctx: BrainContext, query: string, options: { type?: string; limit?: number } = {}): Hit[] {
  const q = tokens(query)
  const fullQuery = fold(query)
  if (q.length === 0 && !fullQuery) return []
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20)
  const hits: Hit[] = []
  for (const c of ctx.contents) {
    if (options.type && c.type !== options.type) continue
    const title = fold(c.title)
    const titleTokens = new Set(title.split(' '))
    const rest = fold([c.description, ...(c.metadata ?? []).map((m) => m.value)].join(' '))
    let score = 0
    for (const t of q) {
      if (titleTokens.has(t)) score += 3
      else if (title.includes(t)) score += 1.5
      else if (rest.includes(t)) score += 0.5
    }
    if (q.length) score /= q.length
    if (fullQuery && title.includes(fullQuery)) score += 3
    if (fullQuery && title === fullQuery) score += 3
    if (score >= 0.9) {
      hits.push({ id: c.id, title: c.title, type: c.type, typeLabel: typeLabelOf(ctx, c.type), summary: summaryOf(c), connections: connectionsOf(ctx, c, 4), score })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
