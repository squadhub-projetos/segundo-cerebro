import { MondayError, readConfig } from '../monday/client.js'
import { runMutation } from '../monday/mutations.js'
import { invalidateGraph } from '../monday/graph.js'
import { RequestError } from '../monday/registry.js'
import { buildContext, typeLabelOf } from './context.js'
import { MAX_ACTIONS, PlanBuilder } from './plan.js'
import type { ActionResult, BrainContext, Endpoint, ExecuteResponse, PlanAction } from './types.js'

/**
 * Execução do plano CONFIRMADO. Nunca confia no que veio do navegador: cada ação é revalidada contra o schema e o grafo atuais
 * (mesma lógica da proposta) e executada pelas MESMAS funções que a interface usa (`runMutation`: criar item e ligar itens).
 * Criações rodam primeiro; ligações, em seguida, uma a uma (a coluna de relação é substituída por inteiro, então o servidor
 * relê a lista atual antes de cada gravação).
 */

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function parseEndpoint(v: unknown): Endpoint {
  const o = (v ?? {}) as { ref?: unknown; id?: unknown }
  if (isStr(o.ref, 20)) return { ref: o.ref }
  if (isStr(o.id, 200)) return { id: o.id }
  throw new RequestError('Plano inválido.')
}

/** Valida o FORMATO do plano recebido (os valores são validados depois, contra o schema). */
export function parseActions(raw: unknown): PlanAction[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ACTIONS) throw new RequestError('Plano inválido.')
  return raw.map((a): PlanAction => {
    const o = (a ?? {}) as Record<string, unknown>
    if (o.kind === 'create') {
      if (!isStr(o.ref, 20) || !isStr(o.type, 60) || !isStr(o.title, 255)) throw new RequestError('Plano inválido.')
      return { kind: 'create', ref: o.ref, type: o.type, title: o.title, ...(typeof o.description === 'string' ? { description: o.description.slice(0, 4000) } : {}) }
    }
    if (o.kind === 'connect') {
      if (!isStr(o.connection, 80)) throw new RequestError('Plano inválido.')
      return { kind: 'connect', connection: o.connection, source: parseEndpoint(o.source), target: parseEndpoint(o.target) }
    }
    throw new RequestError('Plano inválido.')
  })
}

/** Motivo de validação em linguagem simples: só a primeira frase, sem ids e sem instruções feitas para o modelo. */
const plain = (error: string): string => {
  const first = error.replace(/\s*\((?:id|ids) [^)]*\)/g, '').split(/\.\s/)[0]
  return first.endsWith('.') ? first : `${first}.`
}

/** Motivo de falha em linguagem simples (sem detalhes da monday). */
function reasonOf(error: unknown): string {
  if (error instanceof RequestError) return error.message
  if (error instanceof MondayError) return 'a monday recusou a operação'
  return 'ocorreu um erro inesperado'
}

export async function executePlan(env: Record<string, string | undefined>, brainId: string, rawActions: unknown): Promise<ExecuteResponse> {
  const actions = parseActions(rawActions)
  const ctx: BrainContext = await buildContext(env, brainId, true)
  const config = readConfig(env)
  const builder = new PlanBuilder(ctx)
  const byId = new Map(ctx.contents.map((c) => [c.id, c]))

  // 1) Revalidação completa de cada ação, no servidor.
  const results: ActionResult[] = actions.map((a, index) => ({ index, kind: a.kind, status: 'skipped', message: '' }))
  const normalized = new Map<number, PlanAction>()
  actions.forEach((action, index) => {
    const before = builder.actions.length
    const check = builder.ingest(action)
    if (!check.ok) {
      results[index] = { index, kind: action.kind, status: 'failed', message: `Não executei esta ação: ${plain(check.error)}` }
    } else if (builder.actions.length > before) {
      normalized.set(index, builder.actions[before])
    } else {
      results[index] = { index, kind: action.kind, status: 'skipped', message: 'Esta conexão já existia.' }
    }
  })

  // 2) Criações (em paralelo: são itens independentes).
  const nodeOfRef = new Map<string, { id: string; itemId: string; title: string }>()
  const createdIds: string[] = []
  await Promise.all(
    [...normalized].map(async ([index, action]) => {
      if (action.kind !== 'create') return
      const label = typeLabelOf(ctx, action.type)
      try {
        const done = await runMutation(config, { op: 'create', type: action.type, title: action.title, description: action.description, links: [] }, ctx.schema)
        const content = done.content
        if (!content) throw new RequestError('a monday não retornou o item criado')
        nodeOfRef.set(action.ref, { id: content.id, itemId: content.sourceIds?.[0] ?? '', title: content.title })
        createdIds.push(content.id)
        results[index] = { index, kind: 'create', status: 'ok', message: `Criei ${label}: ${content.title}`, contentId: content.id }
      } catch (error) {
        results[index] = { index, kind: 'create', status: 'failed', message: `Não foi possível criar ${label} "${action.title}" (${reasonOf(error)}).` }
      }
    }),
  )

  // 3) Conexões (em sequência).
  const reusedIds = new Set<string>()
  const resolve = (e: Endpoint) => {
    if ('ref' in e) return nodeOfRef.get(e.ref) ?? null
    const c = byId.get(e.id)
    return c ? { id: c.id, itemId: c.sourceIds?.[0] ?? '', title: c.title } : null
  }
  for (const [index, action] of normalized) {
    if (action.kind !== 'connect') continue
    const src = resolve(action.source)
    const tgt = resolve(action.target)
    if (!src || !tgt || !src.itemId || !tgt.itemId) {
      results[index] = { index, kind: 'connect', status: 'skipped', message: 'Não conectei porque um dos conteúdos não foi criado.' }
      continue
    }
    try {
      await runMutation(config, { op: 'link', connection: action.connection, sourceItemId: src.itemId, targetItemId: tgt.itemId }, ctx.schema)
      results[index] = { index, kind: 'connect', status: 'ok', message: `Conectei "${src.title}" a "${tgt.title}".` }
      for (const e of [action.source, action.target]) if ('id' in e) reusedIds.add(e.id)
    } catch (error) {
      results[index] = { index, kind: 'connect', status: 'failed', message: `Não consegui conectar "${src.title}" a "${tgt.title}" (${reasonOf(error)}).` }
    }
  }
  invalidateGraph()

  // 4) Mensagem final (determinística: nenhuma chamada à IA).
  const ok = results.filter((r) => r.status !== 'failed').length === results.length && results.some((r) => r.status === 'ok')
  const created = results.filter((r) => r.kind === 'create' && r.status === 'ok').map((r) => `• ${r.message.replace(/^Criei /, '')}`)
  const linked = results.filter((r) => r.kind === 'connect' && r.status === 'ok').length
  const problems = results.filter((r) => r.status === 'failed' || (r.status === 'skipped' && r.kind === 'connect' && r.message.startsWith('Não conectei'))).map((r) => `• ${r.message}`)
  const lines: string[] = []
  if (created.length) lines.push(`${ok ? 'Pronto. ' : ''}Criei:`, ...created)
  if (reusedIds.size) lines.push('', `Reaproveitei ${reusedIds.size === 1 ? '1 conteúdo que já existia' : `${reusedIds.size} conteúdos que já existiam`}.`)
  if (linked) lines.push('', linked === 1 ? 'Também fiz 1 conexão.' : `Também fiz ${linked} conexões.`)
  if (problems.length) lines.push('', 'Consegui entender o pedido, mas nem tudo foi possível:', ...problems)
  if (!lines.length) lines.push('Nada foi alterado.')
  return { ok, results, createdIds, reusedIds: [...reusedIds], message: lines.join('\n') }
}
