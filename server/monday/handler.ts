import type { IncomingMessage, ServerResponse } from 'node:http'
import { MondayError, fetchBoard, fetchSchema, readConfig } from './client.js'
import { buildFixtureBoards } from './fixtures.js'
import { normalizeMondayGraphData } from './normalize.js'
import { RequestError, parseOp, runMutation } from './mutations.js'
import type { BoardKey, RawBoards } from './types.js'
import type { GraphPayload } from '../../src/types/index.js'

/**
 * Handlers HTTP (Node puro: servem tanto a função da Vercel quanto o middleware do Vite em desenvolvimento).
 * O token fica no servidor. Leitura em `handleGraph`/`handleSchema`; escrita somente em `handleMutate`.
 */

const KEYS: BoardKey[] = ['infoproducts', 'courses', 'youtube']
let cache: { at: number; payload: GraphPayload } | null = null
let inflight: Promise<GraphPayload> | null = null

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

function errorBody(error: unknown) {
  if (error instanceof MondayError) {
    return {
      status: error.code === 'missing_token' ? 503 : 502,
      body: { error: error.code, message: error.message },
    }
  }
  return { status: 500, body: { error: 'internal', message: (error as Error).message } }
}

async function loadGraph(env: Record<string, string | undefined>): Promise<GraphPayload> {
  if (env.MONDAY_FIXTURE === '1') return normalizeMondayGraphData(buildFixtureBoards())
  const config = readConfig(env)
  const boards = await Promise.all(KEYS.map((key) => fetchBoard(config, config.boards[key])))
  const raw = Object.fromEntries(KEYS.map((key, i) => [key, boards[i]])) as unknown as RawBoards
  return normalizeMondayGraphData(raw)
}

/** GET /api/graph[?refresh=1] — grafo normalizado a partir dos 3 quadros. Cache curto em memória. */
export async function handleGraph(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  if (req.method && req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed', message: 'Somente leitura.' })
  const url = new URL(req.url ?? '/', 'http://localhost')
  const refresh = url.searchParams.get('refresh') === '1'
  const ttl = (readConfig(env).cacheSeconds || 0) * 1000
  try {
    if (!refresh && cache && Date.now() - cache.at < ttl) {
      return send(res, 200, cache.payload, { 'X-Cache': 'HIT' })
    }
    inflight ??= loadGraph(env).finally(() => {
      inflight = null
    })
    const payload = await inflight
    cache = { at: Date.now(), payload }
    return send(res, 200, payload, { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' })
  } catch (error) {
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}

/** GET /api/schema — grupos e colunas (id, título, tipo) dos 3 quadros, para conferir o mapeamento. Não retorna itens. */
export async function handleSchema(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  void req
  try {
    if (env.MONDAY_FIXTURE === '1') {
      const raw = buildFixtureBoards()
      return send(res, 200, Object.fromEntries(KEYS.map((k) => [k, { id: raw[k].id, name: raw[k].name, groups: raw[k].groups, columns: raw[k].columns }])))
    }
    const config = readConfig(env)
    const schemas = await Promise.all(KEYS.map((key) => fetchSchema(config, config.boards[key])))
    return send(res, 200, Object.fromEntries(KEYS.map((k, i) => [k, schemas[i]])))
  } catch (error) {
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}

const MAX_BODY = 64 * 1024

function readBody(req: IncomingMessage): Promise<unknown> {
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

/** POST /api/mutate — única rota de escrita (create/update/delete/link/unlink/duplicate). Invalida o cache do grafo. */
export async function handleMutate(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined> = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'Use POST.' })
  // Proteção básica contra CSRF: o navegador só envia Origin do próprio site.
  const origin = req.headers.origin
  if (origin && req.headers.host && new URL(origin).host !== req.headers.host) {
    return send(res, 403, { error: 'forbidden', message: 'Origem não permitida.' })
  }
  const config = readConfig(env)
  if (!config.writesEnabled) return send(res, 403, { error: 'read_only', message: 'Esta implantação está configurada como somente leitura.' })
  if (env.MONDAY_FIXTURE === '1') return send(res, 403, { error: 'read_only', message: 'Dados de demonstração não aceitam gravação.' })
  try {
    const op = parseOp(await readBody(req))
    const result = await runMutation(config, op)
    cache = null
    return send(res, 200, result, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof RequestError) return send(res, 400, { error: 'bad_request', message: error.message })
    cache = null
    const { status, body } = errorBody(error)
    return send(res, status, body)
  }
}
