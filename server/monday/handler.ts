import type { IncomingMessage, ServerResponse } from 'node:http'
import { MondayError, fetchSchema, readConfig } from './client.js'
import { parseOp, runMutation } from './mutations.js'
import { getGraph, invalidateGraph } from './graph.js'
import { PartialError, RequestError, initRegistry, loadRegistry } from './registry.js'
import { createConnection, createNodeType, friendlyMondayError, planConnection, planNodeType, structureDenied, structureStatus } from './structure.js'

/**
 * Handlers HTTP (Node puro: servem tanto a função da Vercel quanto o middleware do Vite em desenvolvimento).
 * O token fica no servidor. Leitura em `handleGraph`/`handleSchema`; escrita de itens em `handleMutate`; alterações do
 * schema (tipos e conexões) em `handleStructure`, com proteção própria.
 */

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

export function errorBody(error: unknown) {
  if (error instanceof RequestError) return { status: 400, body: { error: error.code, message: error.message } }
  if (error instanceof PartialError) return { status: 500, body: { error: 'partial', message: error.message, details: error.details } }
  if (error instanceof MondayError) {
    return {
      status: error.code === 'missing_token' ? 503 : 502,
      body: { error: error.code, message: error.message },
    }
  }
  return { status: 500, body: { error: 'internal', message: (error as Error).message } }
}

/** GET /api/graph[?refresh=1] — grafo normalizado + schema vigente. Cache curto em memória. */
export async function handleGraph(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  if (req.method && req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed', message: 'Somente leitura.' })
  const url = new URL(req.url ?? '/', 'http://localhost')
  const refresh = url.searchParams.get('refresh') === '1'
  const ttl = (readConfig(env).cacheSeconds || 0) * 1000
  try {
    const { payload, hit } = await getGraph(env, refresh, ttl)
    return send(res, 200, payload, { 'X-Cache': hit ? 'HIT' : 'MISS', 'Cache-Control': 'no-store' })
  } catch (error) {
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}

/** GET /api/schema — grupos e colunas (id, título, tipo) dos boards dos tipos ativos, para conferir o mapeamento. Sem itens. */
export async function handleSchema(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  void req
  try {
    const config = readConfig(env)
    const { schema } = await loadRegistry(config, env)
    const active = schema.nodeTypes.filter((t) => t.active)
    const boards = await Promise.all(active.map((t) => fetchSchema(config, t.boardId)))
    return send(res, 200, Object.fromEntries(active.map((t, i) => [t.slug, boards[i]])))
  } catch (error) {
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}

const MAX_BODY = 64 * 1024

const hostOf = (value: string): string | null => {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Proteção contra CSRF: o navegador envia `Origin` nas requisições POST. Aceita o próprio host da requisição (inclui
 * domínio de produção, domínio customizado e previews, porque a página e a API saem do mesmo host), os hosts da Vercel
 * deste projeto (VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL), os listados em ALLOWED_ORIGINS (separados
 * por vírgula) e localhost. Retorna a mensagem de recusa, ou null se permitido.
 */
export function originDenied(req: IncomingMessage, env: Record<string, string | undefined>): string | null {
  const origin = req.headers.origin
  if (!origin) return null // chamadas sem navegador (curl, servidor) não enviam Origin
  const originHost = hostOf(origin)
  if (!originHost) return 'Origem inválida.'
  const allowed = new Set<string>()
  for (const h of [req.headers.host, req.headers['x-forwarded-host']]) {
    for (const part of String(h ?? '').split(',')) {
      const host = hostOf(part.trim())
      if (host) allowed.add(host)
    }
  }
  for (const v of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.APP_ORIGIN, ...(env.ALLOWED_ORIGINS ?? '').split(',')]) {
    const host = v ? hostOf(v.trim()) : null
    if (host) allowed.add(host)
  }
  if (allowed.has(originHost) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHost)) return null
  return `Origem não permitida (${originHost}). Configure ALLOWED_ORIGINS na Vercel se este domínio for legítimo.`
}

export function readBody(req: IncomingMessage): Promise<unknown> {
  // A Vercel já entrega `req.body` interpretado; no Vite lemos o fluxo.
  const preset = (req as IncomingMessage & { body?: unknown }).body
  if (preset !== undefined) return Promise.resolve(typeof preset === 'string' ? JSON.parse(preset) : preset)
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new RequestError('Requisição grande demais.'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
      } catch {
        reject(new RequestError('Corpo da requisição inválido.'))
      }
    })
    req.on('error', reject)
  })
}

/** POST /api/mutate — escrita de itens (create/update/delete/link/unlink/duplicate). Invalida o cache do grafo. */
export async function handleMutate(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  const config = readConfig(env)
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed', message: 'Use POST.', writesEnabled: config.writesEnabled })
  }
  const denied = originDenied(req, env)
  if (denied) return send(res, 403, { error: 'forbidden_origin', message: denied })
  if (!config.writesEnabled) return send(res, 403, { error: 'writes_disabled', message: 'Escrita na monday está desabilitada (MONDAY_WRITE_ENABLED=0).' })
  try {
    const op = parseOp(await readBody(req))
    const { schema } = await loadRegistry(config, env)
    const result = await runMutation(config, op, schema)
    invalidateGraph()
    return send(res, 200, result, { 'Cache-Control': 'no-store' })
  } catch (error) {
    invalidateGraph()
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}

/**
 * /api/structure — alterações do SCHEMA (tipos de conteúdo e de conexão). GET devolve o status e as permissões; POST executa
 * `init`, `preview-node-type`, `create-node-type`, `preview-connection` e `create-connection`. Toda gravação passa pela
 * proteção de `structureDenied` (habilitação explícita + chave de administração em produção).
 */
export async function handleStructure(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  const config = readConfig(env)
  try {
    if (req.method === 'GET') return send(res, 200, await structureStatus(config, env), { 'Cache-Control': 'no-store' })
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'Use GET ou POST.' })
    const origin = originDenied(req, env)
    if (origin) return send(res, 403, { error: 'forbidden_origin', message: origin })
    const denied = structureDenied(req, env)
    if (denied) return send(res, denied.status, { error: denied.error, message: denied.message })
    const body = ((await readBody(req)) ?? {}) as Record<string, unknown>
    let result: unknown
    switch (body.op) {
      case 'init':
        result = await initRegistry(config, env)
        break
      case 'preview-node-type':
        result = await planNodeType(config, env, body)
        break
      case 'create-node-type':
        result = await createNodeType(config, env, body)
        break
      case 'preview-connection': {
        const plan = await planConnection(config, env, body)
        result = {
          input: plan.input,
          sourceName: plan.source.name,
          targetName: plan.target.name,
          boardName: plan.boardName,
          columnTitle: plan.columnTitle,
          multiple: plan.multiple,
          sameBoard: plan.sameBoard,
          reflection: plan.reflection,
        }
        break
      }
      case 'create-connection':
        result = await createConnection(config, env, body)
        break
      default:
        throw new RequestError('Operação desconhecida.')
    }
    invalidateGraph()
    return send(res, 200, { ok: true, ...(result as object) }, { 'Cache-Control': 'no-store' })
  } catch (error) {
    invalidateGraph()
    const { status, body } = errorBody(friendlyMondayError(error))
    return send(res, status, body)
  }
}
