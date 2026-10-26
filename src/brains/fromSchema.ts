import type { SchemaPayload } from '../types/schema'
import { iconOf } from '../lib/icons'
import type { BrainConfig } from './types'

/**
 * Cérebro em execução: a configuração estática (nome, ícone, textos) com os TIPOS e CONEXÕES vindos do registry na monday.
 * Sem schema (demonstração), vale a configuração estática.
 */
export function brainFromSchema(base: BrainConfig, schema: SchemaPayload | null): BrainConfig {
  if (!schema) return base
  const types = schema.nodeTypes.filter((t) => t.brainId === base.id && t.active)
  const boardOf = (slug: string) => types.find((t) => t.slug === slug)
  return {
    ...base,
    nodeTypes: types.map((t) => ({
      id: t.slug,
      label: t.name,
      plural: t.plural,
      description: t.description || 'Sem descrição.',
      origin: t.boardName ? `Board "${t.boardName}" (monday.com)` : 'monday.com',
      accent: t.accent,
      Icon: iconOf(t.icon),
      boardId: t.boardId,
      boardName: t.boardName,
      role: t.role,
    })),
    connections: schema.connections
      .filter((c) => c.brainId === base.id && c.active && boardOf(c.source) && boardOf(c.target))
      .map((c) => {
        const holder = boardOf(c.storedOn === 'source' ? c.source : c.target)
        return {
          id: c.id,
          relationType: c.id,
          from: c.source,
          to: c.target,
          kind: c.nature,
          label: c.label,
          reverseLabel: c.reverseLabel,
          description: c.description ?? `${boardOf(c.source)?.name} ${c.label} ${boardOf(c.target)?.name}.`,
          storage: `Coluna Connect Boards no board "${holder?.boardName ?? holder?.name}".`,
          name: c.name,
          cardinality: c.cardinality,
          storedOn: c.storedOn,
          columnId: c.columnId,
          reflectionColumnId: c.reflectionColumnId,
        }
      }),
  }
}
