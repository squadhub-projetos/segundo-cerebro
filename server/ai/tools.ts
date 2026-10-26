import type { FunctionTool } from './client.js'
import { connectionsOf, searchContents, summaryOf, typeLabelOf } from './context.js'
import { PlanBuilder, cardinalityText, toEndpoint } from './plan.js'
import type { BrainContext } from './types.js'

/**
 * Tools expostas ao modelo. São operações de NEGÓCIO do Segundo Cérebro (nunca GraphQL, ids de coluna ou mutations da monday).
 *
 *  LEITURA (executam na hora, sem confirmação): get_brain_schema, search_content, get_content_details.
 *  ESCRITA (apenas REGISTRAM uma proposta no plano; nada é gravado): create_content, connect_content.
 *
 * O plano só é executado depois da confirmação humana, por outro endpoint, que revalida cada ação. O cérebro vem do contexto da
 * requisição: o modelo não escolhe nem troca de cérebro.
 */

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): FunctionTool => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters: { type: 'object', properties, required, additionalProperties: false },
})

export const READ_TOOLS = new Set(['get_brain_schema', 'search_content', 'get_content_details'])
export const WRITE_TOOLS = new Set(['create_content', 'connect_content'])

export const TOOLS: FunctionTool[] = [
  fn('get_brain_schema', 'Retorna os tipos de conteúdo e as conexões permitidas do cérebro ativo (com cardinalidade e quantidade de itens).', {}, []),
  fn(
    'search_content',
    'Procura conteúdos que já existem no cérebro ativo (por título, descrição e metadados). Use ANTES de criar qualquer coisa, para evitar duplicidade e encontrar conteúdo reaproveitável.',
    {
      query: { type: 'string', description: 'Palavras-chave do conteúdo procurado.' },
      type: { type: ['string', 'null'], description: 'Id do tipo para restringir a busca, ou null.' },
      limit: { type: ['integer', 'null'], description: 'Máximo de resultados (padrão 8), ou null.' },
    },
    ['query', 'type', 'limit'],
  ),
  fn(
    'get_content_details',
    'Retorna os detalhes (descrição, campos principais e conexões) de um conteúdo existente.',
    { content_id: { type: 'string', description: 'Id do conteúdo, como retornado por search_content.' } },
    ['content_id'],
  ),
  fn(
    'create_content',
    'PROPÕE a criação de um conteúdo novo (não grava nada: só entra no plano que o usuário vai confirmar). Retorna uma referência ("novo-1") para usar em connect_content.',
    {
      node_type_id: { type: 'string', description: 'Id de um tipo do cérebro (ver get_brain_schema).' },
      title: { type: 'string', description: 'Título do conteúdo.' },
      description: { type: ['string', 'null'], description: 'Descrição curta, ou null.' },
    },
    ['node_type_id', 'title', 'description'],
  ),
  fn(
    'connect_content',
    'PROPÕE conectar dois conteúdos por uma conexão que já existe no schema (não grava nada: só entra no plano). Cada ponta é o id de um conteúdo existente OU a referência de um create_content do plano.',
    {
      connection_type_id: { type: 'string', description: 'Id de uma conexão do cérebro (ver get_brain_schema).' },
      source_content_id: { type: 'string', description: 'Origem da conexão (id existente ou referência "novo-N").' },
      target_content_id: { type: 'string', description: 'Destino da conexão (id existente ou referência "novo-N").' },
    },
    ['connection_type_id', 'source_content_id', 'target_content_id'],
  ),
]

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Executa uma tool e devolve o resultado (objeto serializável) que volta ao modelo. */
export function runTool(name: string, rawArgs: string, ctx: BrainContext, builder: PlanBuilder): unknown {
  let args: Record<string, unknown>
  try {
    args = (JSON.parse(rawArgs || '{}') ?? {}) as Record<string, unknown>
  } catch {
    return { error: 'Argumentos inválidos (JSON).' }
  }
  switch (name) {
    case 'get_brain_schema':
      return {
        cerebro: { id: ctx.brainId, nome: ctx.brainName },
        tipos: ctx.types.map((t) => ({ id: t.slug, nome: t.name, plural: t.plural, descricao: t.description, itens: ctx.contents.filter((c) => c.type === t.slug).length, aceita_descricao: Boolean(t.descriptionColumnId) })),
        conexoes: ctx.connections.map((c) => ({
          id: c.id,
          origem: c.source,
          destino: c.target,
          descricao: `${typeLabelOf(ctx, c.source)} ${c.label} ${typeLabelOf(ctx, c.target)}`,
          sentido_inverso: `${typeLabelOf(ctx, c.target)} ${c.reverseLabel} ${typeLabelOf(ctx, c.source)}`,
          natureza: c.nature === 'hierarchy' ? 'hierarquia' : 'associação',
          cardinalidade: cardinalityText(c.cardinality),
        })),
      }
    case 'search_content': {
      const hits = searchContents(ctx, str(args.query), { type: str(args.type) || undefined, limit: typeof args.limit === 'number' ? args.limit : undefined })
      return { resultados: hits.map((h) => ({ id: h.id, title: h.title, type: h.type, typeLabel: h.typeLabel, summary: h.summary, connections: h.connections })), total: hits.length, dica: hits.length === 0 ? 'Nada parecido encontrado.' : undefined }
    }
    case 'get_content_details': {
      const c = ctx.contents.find((x) => x.id === str(args.content_id))
      if (!c) return { error: 'Conteúdo não encontrado neste cérebro.' }
      return {
        id: c.id,
        titulo: c.title,
        tipo: typeLabelOf(ctx, c.type),
        resumo: summaryOf(c),
        campos: (c.metadata ?? []).slice(0, 12).map((m) => ({ campo: m.label, valor: m.value.length > 120 ? `${m.value.slice(0, 117)}…` : m.value })),
        conexoes: connectionsOf(ctx, c, 20),
      }
    }
    case 'create_content': {
      const r = builder.create({ type: str(args.node_type_id), title: str(args.title), description: typeof args.description === 'string' ? args.description : null })
      return r.ok ? { registrado: true, ref: r.ref, aviso: 'Isto só entra no plano; nada foi criado ainda.' } : { error: r.error }
    }
    case 'connect_content': {
      const r = builder.connect({ connection: str(args.connection_type_id), source: toEndpoint(str(args.source_content_id)), target: toEndpoint(str(args.target_content_id)) })
      return r.ok ? { registrado: !r.skipped, observacao: r.skipped, aviso: 'Isto só entra no plano; nada foi conectado ainda.' } : { error: r.error }
    }
    default:
      return { error: `Ferramenta desconhecida: ${name}.` }
  }
}
