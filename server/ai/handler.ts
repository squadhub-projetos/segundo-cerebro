import type { IncomingMessage, ServerResponse } from 'node:http'
import { readConfig } from '../monday/client.js'
import { errorBody, originDenied, readBody, send } from '../monday/handler.js'
import { RequestError } from '../monday/registry.js'
import { AiError, aiEnabled, readAiConfig } from './client.js'
import { buildContext } from './context.js'
import { executePlan, parseActions } from './executor.js'
import { PlanBuilder } from './plan.js'
import { planFromChat } from './planner.js'
import type { ChatTurn } from './types.js'

/**
 * Endpoints do assistente: POST /api/ai/chat (interpreta e PROPÕE; não grava nada) e POST /api/ai/execute (executa o plano
 * confirmado, revalidando tudo). OPENAI_API_KEY só existe aqui (servidor).
 */

const RATE = { chat: { max: 20, windowMs: 60_000 }, execute: { max: 10, windowMs: 60_000 } } as const
const hits = new Map<string, number[]>()

/** Limite simples por IP e rota (por instância): evita que um visitante consuma a cota da OpenAI. */
function limited(req: IncomingMessage, route: keyof typeof RATE): boolean {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local').split(',')[0].trim()
  const key = `${route}:${ip}`
  const now = Date.now()
  const { max, windowMs } = RATE[route]
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(key, recent)
  return recent.length > max
}

const NOT_CONFIGURED = { error: 'ai_not_configured', message: 'O assistente não está configurado neste ambiente.' }
const FAILED = 'O assistente não conseguiu analisar sua solicitação agora.'

function parseTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) throw new RequestError('Conversa inválida.')
  const turns = raw.map((m): ChatTurn => {
    const o = (m ?? {}) as { role?: unknown; content?: unknown }
    if ((o.role !== 'user' && o.role !== 'assistant') || typeof o.content !== 'string' || !o.content.trim() || o.content.length > 4000) {
      throw new RequestError('Mensagem inválida.')
    }
    return { role: o.role, content: o.content }
  })
  if (turns[turns.length - 1].role !== 'user') throw new RequestError('A última mensagem precisa ser do usuário.')
  return turns
}

export async function handleAiChat(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  if (req.method === 'GET') return send(res, 200, { enabled: aiEnabled(env), model: aiEnabled(env) ? readAiConfig(env).model : null }, { 'Cache-Control': 'no-store' })
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'Use POST.' })
  const denied = originDenied(req, env)
  if (denied) return send(res, 403, { error: 'forbidden_origin', message: denied })
  if (!aiEnabled(env)) return send(res, 503, NOT_CONFIGURED)
  if (limited(req, 'chat')) return send(res, 429, { error: 'rate_limited', message: 'Muitas solicitações em pouco tempo. Aguarde um instante.' })
  try {
    const body = ((await readBody(req)) ?? {}) as Record<string, unknown>
    const brainId = typeof body.brainId === 'string' ? body.brainId : ''
    const turns = parseTurns(body.messages)
    const ctx = await buildContext(env, brainId)
    // Plano atual (para "Ajustar"): só entra no contexto se passar de novo pela validação.
    let current = null
    if (body.currentPlan) {
      try {
        const b = new PlanBuilder(ctx)
        for (const a of parseActions((body.currentPlan as { actions?: unknown }).actions)) b.ingest(a)
        current = b.actions.length ? b.plan() : null
      } catch {
        current = null
      }
    }
    const answer = await planFromChat(env, ctx, turns, current)
    return send(res, 200, answer, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof AiError) {
      console.error(`[SecondBrain] assistente: ${error.code}`)
      return send(res, 502, { error: error.code, message: FAILED })
    }
    const { status, body } = errorBody(error)
    return send(res, status, status >= 500 ? { error: body.error, message: FAILED } : body)
  }
}

export async function handleAiExecute(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'Use POST.' })
  const denied = originDenied(req, env)
  if (denied) return send(res, 403, { error: 'forbidden_origin', message: denied })
  if (!readConfig(env).writesEnabled) return send(res, 403, { error: 'writes_disabled', message: 'Escrita na monday está desabilitada (MONDAY_WRITE_ENABLED=0).' })
  if (limited(req, 'execute')) return send(res, 429, { error: 'rate_limited', message: 'Muitas solicitações em pouco tempo. Aguarde um instante.' })
  try {
    const body = ((await readBody(req)) ?? {}) as Record<string, unknown>
    const brainId = typeof body.brainId === 'string' ? body.brainId : ''
    const result = await executePlan(env, brainId, body.actions)
    return send(res, 200, result, { 'Cache-Control': 'no-store' })
  } catch (error) {
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}
