import type { Content, ContentType, Relation, RelationType } from '../types'

interface RelationRule {
  source: ContentType
  target: ContentType
  /** Texto na perspectiva de quem origina a relação. */
  outLabel: string
  /** Texto na perspectiva de quem recebe a relação. */
  inLabel: string
  /** Texto curto usado na aresta do grafo. */
  edgeLabel: string
  /** Estrutural (composição: pai contém filho) ou associativa (ligação livre entre conteúdos). */
  kind: 'structural' | 'associative'
}

export const RELATION_RULES: Record<RelationType, RelationRule> = {
  'direciona-para': {
    source: 'criativo',
    target: 'pagina',
    outLabel: 'Direciona para a página',
    inLabel: 'Recebe direcionamento de',
    edgeLabel: 'direciona para',
    kind: 'associative',
  },
  apresenta: {
    source: 'pagina',
    target: 'curso',
    outLabel: 'Apresenta o curso',
    inLabel: 'Apresentada na página',
    edgeLabel: 'apresenta',
    kind: 'structural',
  },
  contem: {
    source: 'curso',
    target: 'aula',
    outLabel: 'Contém a aula',
    inLabel: 'Pertence ao curso',
    edgeLabel: 'contém',
    kind: 'structural',
  },
  'contem-aula': {
    source: 'infoproduto',
    target: 'aula',
    outLabel: 'Contém a aula',
    inLabel: 'Usada no infoproduto',
    edgeLabel: 'contém',
    kind: 'structural',
  },
  divulga: {
    source: 'youtube',
    target: 'infoproduto',
    outLabel: 'Direciona para o infoproduto',
    inLabel: 'Recebe o vídeo',
    edgeLabel: 'direciona para',
    kind: 'associative',
  },
}

export const RELATION_TYPES = Object.keys(RELATION_RULES) as RelationType[]

export function isCompatible(type: RelationType, sourceType: ContentType, targetType: ContentType) {
  const rule = RELATION_RULES[type]
  return rule.source === sourceType && rule.target === targetType
}

/** Opções de vínculo para um tipo: papel de origem ou de destino. */
export interface LinkOption {
  relationType: RelationType
  /** Papel do conteúdo editado na relação. */
  role: 'source' | 'target'
  otherType: ContentType
  label: string
}

export function linkOptionsFor(type: ContentType): LinkOption[] {
  const options: LinkOption[] = []
  for (const relationType of RELATION_TYPES) {
    const rule = RELATION_RULES[relationType]
    if (rule.source === type) {
      options.push({ relationType, role: 'source', otherType: rule.target, label: rule.outLabel })
    }
    if (rule.target === type) {
      options.push({ relationType, role: 'target', otherType: rule.source, label: rule.inLabel })
    }
  }
  return options
}

export function validateRelation(
  rel: Pick<Relation, 'source' | 'target' | 'type'>,
  contents: Content[],
  existing: Relation[],
): string | null {
  if (rel.source === rel.target) return 'Um conteúdo não pode se relacionar com ele mesmo.'
  const source = contents.find((c) => c.id === rel.source)
  const target = contents.find((c) => c.id === rel.target)
  if (!source || !target) return 'A relação aponta para um conteúdo inexistente.'
  if (!(rel.type in RELATION_RULES)) return 'Tipo de relação desconhecido.'
  if (!isCompatible(rel.type, source.type, target.type)) {
    return 'Esses tipos de conteúdo não podem ser vinculados dessa forma.'
  }
  const duplicate = existing.some(
    (r) => r.source === rel.source && r.target === rel.target && r.type === rel.type,
  )
  if (duplicate) return 'Essa relação já existe.'
  return null
}

export function newId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}-${raw}`
}

export const TYPE_NAME: Record<ContentType, string> = {
  criativo: 'Criativo',
  pagina: 'Página',
  curso: 'Curso',
  aula: 'Aula',
  infoproduto: 'Infoproduto',
  youtube: 'Vídeo do YouTube',
}

export type InferResult =
  | { ok: true; relation: Pick<Relation, 'source' | 'target' | 'type'> }
  | { ok: false; reason: string }

/**
 * Infere tipo e direção de uma conexão feita no mapa a partir dos tipos dos dois conteúdos
 * (cada par de tipos tem no máximo uma relação possível), preservando a semântica existente:
 * ligar uma aula a um curso sempre grava curso → aula.
 */
export function inferRelation(contents: Content[], relations: Relation[], aId: string, bId: string): InferResult {
  const a = contents.find((c) => c.id === aId)
  const b = contents.find((c) => c.id === bId)
  if (!a || !b) return { ok: false, reason: 'Conteúdo inexistente.' }
  if (a.id === b.id) return { ok: false, reason: 'Um conteúdo não pode ser conectado a ele mesmo.' }
  let found: Pick<Relation, 'source' | 'target' | 'type'> | null = null
  for (const type of RELATION_TYPES) {
    if (isCompatible(type, a.type, b.type)) found = { source: a.id, target: b.id, type }
    else if (isCompatible(type, b.type, a.type)) found = { source: b.id, target: a.id, type }
    if (found) break
  }
  if (!found) {
    return { ok: false, reason: `${TYPE_NAME[a.type]} e ${TYPE_NAME[b.type].toLowerCase()} não podem ser conectados.` }
  }
  const { source, target, type } = found
  if (relations.some((r) => r.source === source && r.target === target && r.type === type)) {
    return { ok: false, reason: 'Esses conteúdos já estão conectados.' }
  }
  return { ok: true, relation: found }
}
