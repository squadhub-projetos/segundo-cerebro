import { fold } from '../monday/normalize.js'
import type { ConnectionDef } from '../../src/types/schema.js'
import type { ActionPlan, BrainContext, Endpoint, PlanAction, PlanConnect, PlanCreate, PlanView, ProposedPlan } from './types.js'

/**
 * Validação do plano. Esta MESMA lógica valida (1) cada proposta enquanto a IA monta o plano e (2) cada ação de novo, no
 * servidor, quando o usuário confirma: o plano que volta do navegador nunca é confiado.
 */

export const MAX_ACTIONS = 30
const REF = /^novo-\d+$/

export type Check<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const epKey = (e: Endpoint) => ('ref' in e ? `ref:${e.ref}` : `id:${e.id}`)

/** Interpreta o texto vindo do modelo: "novo-1" é um conteúdo do plano; qualquer outro valor é o id de um conteúdo existente. */
export const toEndpoint = (value: string): Endpoint => (REF.test(value.trim()) ? { ref: value.trim() } : { id: value.trim() })

const humanCardinality = { 'one-one': 'um para um', 'one-many': 'um para muitos', 'many-many': 'muitos para muitos' } as const
export const cardinalityText = (c: ConnectionDef['cardinality']) => humanCardinality[c]

export class PlanBuilder {
  actions: PlanAction[] = []
  warnings: string[] = []
  private next = 1

  constructor(private ctx: BrainContext) {}

  private creates(): PlanCreate[] {
    return this.actions.filter((a): a is PlanCreate => a.kind === 'create')
  }

  private connects(): PlanConnect[] {
    return this.actions.filter((a): a is PlanConnect => a.kind === 'connect')
  }

  private typeOfEndpoint(e: Endpoint): Check<{ type: string; title: string }> {
    if ('ref' in e) {
      const c = this.creates().find((x) => x.ref === e.ref)
      return c ? { ok: true, type: c.type, title: c.title } : { ok: false, error: `O item "${e.ref}" não faz parte do plano. Crie-o antes com create_content.` }
    }
    const c = this.ctx.contents.find((x) => x.id === e.id)
    return c ? { ok: true, type: c.type, title: c.title } : { ok: false, error: `Conteúdo "${e.id}" não encontrado neste cérebro. Use ids retornados por search_content.` }
  }

  /** Registra a criação de um conteúdo novo. `forcedRef` só é usado ao revalidar um plano confirmado. */
  create(args: { type: string; title: string; description?: string | null }, forcedRef?: string): Check<{ ref: string }> {
    if (this.actions.length >= MAX_ACTIONS) return { ok: false, error: `O plano pode ter no máximo ${MAX_ACTIONS} ações.` }
    const type = this.ctx.types.find((t) => t.slug === args.type)
    if (!type) {
      return { ok: false, error: `Tipo "${args.type}" não existe neste cérebro. Tipos disponíveis: ${this.ctx.types.map((t) => `${t.slug} (${t.name})`).join(', ') || 'nenhum'}.` }
    }
    const title = (args.title ?? '').trim().replace(/\s+/g, ' ')
    if (!title) return { ok: false, error: 'O título não pode ficar vazio.' }
    if (title.length > 255) return { ok: false, error: 'O título passa de 255 caracteres.' }
    const key = fold(title)
    const existing = this.ctx.contents.find((c) => c.type === type.slug && fold(c.title) === key)
    if (existing) {
      return { ok: false, error: `Já existe ${type.name} "${existing.title}" (id ${existing.id}). Reutilize-o em vez de criar outro: use esse id em connect_content.` }
    }
    if (this.creates().some((c) => c.type === type.slug && fold(c.title) === key)) {
      return { ok: false, error: `O plano já cria ${type.name} "${title}". Use a referência dele em vez de criar outro.` }
    }
    const ref = forcedRef ?? `novo-${this.next}`
    if (!REF.test(ref) || this.creates().some((c) => c.ref === ref)) return { ok: false, error: 'Referência inválida ou repetida.' }
    this.next = Math.max(this.next, Number(ref.slice(5)) + 1)
    let description = typeof args.description === 'string' ? args.description.trim().slice(0, 4000) : undefined
    if (description && !type.descriptionColumnId) {
      this.warnings.push(`${type.name} não tem campo de descrição: a descrição de "${title}" não será salva.`)
      description = undefined
    }
    this.actions.push({ kind: 'create', ref, type: type.slug, title, ...(description ? { description } : {}) })
    return { ok: true, ref }
  }

  /** Registra uma conexão. Corrige a direção quando os tipos batem ao contrário; recusa regras inexistentes. */
  connect(args: { connection: string; source: Endpoint; target: Endpoint }): Check<{ skipped?: string }> {
    if (this.actions.length >= MAX_ACTIONS) return { ok: false, error: `O plano pode ter no máximo ${MAX_ACTIONS} ações.` }
    const conn = this.ctx.connections.find((c) => c.id === args.connection)
    if (!conn) {
      return {
        ok: false,
        error: `Conexão "${args.connection}" não existe neste cérebro. Conexões disponíveis: ${this.ctx.connections.map((c) => `${c.id} (${c.source} ${c.label} ${c.target})`).join('; ') || 'nenhuma'}. Não crie conexões novas: avise o usuário.`,
      }
    }
    let source = args.source
    let target = args.target
    const a = this.typeOfEndpoint(source)
    if (!a.ok) return a
    const b = this.typeOfEndpoint(target)
    if (!b.ok) return b
    let sourceTitle = a.title
    let targetTitle = b.title
    if (a.type === conn.target && b.type === conn.source && !(a.type === conn.source && b.type === conn.target)) {
      ;[source, target] = [target, source]
      ;[sourceTitle, targetTitle] = [targetTitle, sourceTitle]
    } else if (!(a.type === conn.source && b.type === conn.target)) {
      const name = (slug: string) => this.ctx.types.find((t) => t.slug === slug)?.name ?? slug
      return { ok: false, error: `A conexão "${conn.label}" liga ${name(conn.source)} a ${name(conn.target)}, mas os itens informados são ${name(a.type)} e ${name(b.type)}.` }
    }
    if (epKey(source) === epKey(target)) return { ok: false, error: 'Um conteúdo não pode ser conectado a ele mesmo.' }

    // Já existente na monday: nada a fazer.
    if ('id' in source && 'id' in target && this.ctx.relations.some((r) => r.type === conn.id && r.source === source.id && r.target === target.id)) {
      this.warnings.push(`"${sourceTitle}" e "${targetTitle}" já estavam conectados.`)
      return { ok: true, skipped: 'já conectados' }
    }
    if (this.connects().some((c) => c.connection === conn.id && epKey(c.source) === epKey(source) && epKey(c.target) === epKey(target))) {
      return { ok: true, skipped: 'já está no plano' }
    }

    // Cardinalidade (a monday também impõe no momento de gravar).
    if (conn.cardinality !== 'many-many') {
      const planned = this.connects().filter((c) => c.connection === conn.id)
      const incoming = [
        ...('id' in target ? this.ctx.relations.filter((r) => r.type === conn.id && r.target === target.id).map((r): Endpoint => ({ id: r.source })) : []),
        ...planned.filter((c) => epKey(c.target) === epKey(target)).map((c) => c.source),
      ]
      if (incoming.some((s) => epKey(s) !== epKey(source))) {
        return { ok: false, error: `"${targetTitle}" já está ligado a outro item por "${conn.label}" (cardinalidade ${cardinalityText(conn.cardinality)}).` }
      }
      if (conn.cardinality === 'one-one') {
        const outgoing = [
          ...('id' in source ? this.ctx.relations.filter((r) => r.type === conn.id && r.source === source.id).map((r): Endpoint => ({ id: r.target })) : []),
          ...planned.filter((c) => epKey(c.source) === epKey(source)).map((c) => c.target),
        ]
        if (outgoing.some((t) => epKey(t) !== epKey(target))) {
          return { ok: false, error: `"${sourceTitle}" já está ligado a outro item por "${conn.label}" (cardinalidade um para um).` }
        }
      }
    }
    this.actions.push({ kind: 'connect', connection: conn.id, source, target })
    return { ok: true }
  }

  /** Reaplica uma ação vinda de um plano (confirmação). */
  ingest(action: PlanAction): Check<{ skipped?: string }> {
    if (action.kind === 'create') {
      const r = this.create({ type: action.type, title: action.title, description: action.description }, action.ref)
      return r.ok ? { ok: true } : r
    }
    return this.connect({ connection: action.connection, source: action.source, target: action.target })
  }

  plan(): ActionPlan {
    return { brainId: this.ctx.brainId, actions: this.actions, warnings: this.warnings }
  }
}

/* ------------------------------------------------------------------ apresentação */

export function describePlan(plan: ActionPlan, ctx: BrainContext): PlanView {
  const byId = new Map(ctx.contents.map((c) => [c.id, c]))
  const creates = plan.actions.filter((a): a is PlanCreate => a.kind === 'create')
  const refTitle = new Map(creates.map((c) => [c.ref, c.title]))
  const titleOf = (e: Endpoint) => ('ref' in e ? refTitle.get(e.ref) : byId.get(e.id)?.title) ?? '?'
  const typeName = (slug: string) => ctx.types.find((t) => t.slug === slug)

  const lines: PlanView['lines'] = []
  const counts = new Map<string, number>()
  for (const c of creates) {
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
    lines.push({ kind: 'create', text: `Criar ${typeName(c.type)?.name ?? c.type}: ${c.title}` })
  }
  const reused = new Set<string>()
  const connects = plan.actions.filter((a): a is PlanConnect => a.kind === 'connect')
  for (const c of connects) {
    for (const e of [c.source, c.target]) {
      if ('id' in e && !reused.has(e.id)) {
        reused.add(e.id)
        const content = byId.get(e.id)
        lines.push({ kind: 'reuse', text: `Reutilizar ${typeName(content?.type ?? '')?.name ?? 'item'}: ${content?.title ?? '?'}` })
      }
    }
  }
  for (const c of connects) {
    const conn = ctx.connections.find((x) => x.id === c.connection)
    lines.push({ kind: 'connect', text: `${titleOf(c.source)} ${conn?.label ?? 'se conecta a'} ${titleOf(c.target)}` })
  }
  return {
    creates: [...counts].map(([slug, count]) => ({ typeLabel: typeName(slug)?.name ?? slug, typePlural: typeName(slug)?.plural ?? slug, count })),
    reuses: reused.size,
    connections: connects.length,
    lines,
  }
}

export function proposed(plan: ActionPlan, ctx: BrainContext): ProposedPlan {
  return { ...plan, view: describePlan(plan, ctx) }
}
