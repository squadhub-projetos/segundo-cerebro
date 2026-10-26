import type { SchemaPayload } from '../types/schema'
import { RELATION_RULES, RELATION_TYPES, TYPE_NAME } from './relations'
import { NODE_RADIUS, NODE_SIZE } from './dimensions'
import { iconOf } from './icons'
import { CONTENT_TYPES, LAYOUT_KIND, TYPE_ACCENT, TYPE_META, setSelectableTypes } from '../components/meta'

/**
 * Aplica o schema vigente (tipos e conexões vindos do registry na monday) às tabelas usadas pela interface: rótulos, ícones,
 * tamanhos dos cards, cores e regras de relação. As tabelas continuam sendo objetos de módulo (as telas leem direto delas),
 * então o registro altera o conteúdo EM LUGAR. `applySchema(null)` restaura os padrões da demonstração.
 */

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T

// Padrões (capturados uma vez, antes de qualquer alteração).
const BASE = {
  rules: clone(RELATION_RULES),
  typeName: clone(TYPE_NAME),
  size: clone(NODE_SIZE),
  radius: clone(NODE_RADIUS),
  layout: clone(LAYOUT_KIND),
  accent: clone(TYPE_ACCENT),
  meta: { ...TYPE_META },
  contentTypes: [...CONTENT_TYPES],
}

function replace<T extends object>(target: T, source: T) {
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k]
  Object.assign(target, source)
}

/** Aparência de um tipo criado pela plataforma: um card de largura média (o mesmo desenho de "página"). */
const CUSTOM_LAYOUT = 'pagina' as const

export function applySchema(schema: SchemaPayload | null) {
  replace(RELATION_RULES, clone(BASE.rules))
  replace(TYPE_NAME, clone(BASE.typeName))
  replace(NODE_SIZE, clone(BASE.size))
  replace(NODE_RADIUS, clone(BASE.radius))
  replace(LAYOUT_KIND, clone(BASE.layout))
  replace(TYPE_ACCENT, clone(BASE.accent))
  replace(TYPE_META, { ...BASE.meta })
  CONTENT_TYPES.splice(0, CONTENT_TYPES.length, ...BASE.contentTypes)
  RELATION_TYPES.splice(0, RELATION_TYPES.length, ...Object.keys(RELATION_RULES))
  if (!schema) return

  const types = schema.nodeTypes.filter((t) => t.active)
  for (const t of types) {
    TYPE_META[t.slug] = { label: t.name, plural: t.plural, Icon: iconOf(t.icon) }
    TYPE_NAME[t.slug] = t.name
    TYPE_ACCENT[t.slug] = t.accent
    if (!NODE_SIZE[t.slug]) {
      NODE_SIZE[t.slug] = { ...NODE_SIZE[CUSTOM_LAYOUT] }
      NODE_RADIUS[t.slug] = NODE_RADIUS[CUSTOM_LAYOUT]
      LAYOUT_KIND[t.slug] = CUSTOM_LAYOUT
    }
  }
  // Com dados da monday, valem SOMENTE as regras do schema (as da demonstração saem).
  replace(RELATION_RULES, {})
  for (const c of schema.connections.filter((x) => x.active)) {
    RELATION_RULES[c.id] = {
      source: c.source,
      target: c.target,
      outLabel: c.label,
      inLabel: c.reverseLabel,
      edgeLabel: c.label,
      kind: c.nature === 'hierarchy' ? 'structural' : 'associative',
    }
  }
  RELATION_TYPES.splice(0, RELATION_TYPES.length, ...Object.keys(RELATION_RULES))
  const slugs = types.map((t) => t.slug)
  CONTENT_TYPES.splice(0, CONTENT_TYPES.length, ...slugs)
  setSelectableTypes(slugs)
}
