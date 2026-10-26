import { fetchBoard, readConfig } from './client.js'
import { normalizeMondayGraphData } from './normalize.js'
import { invalidateRegistry, loadRegistry } from './registry.js'
import type { RawBoards } from './types.js'
import type { GraphPayload } from '../../src/types/index.js'

/**
 * Grafo normalizado + schema, com cache curto em memória (compartilhado por /api/graph e pelo assistente). Qualquer gravação
 * ou alteração estrutural deve chamar `invalidateGraph()`.
 */

let cache: { at: number; payload: GraphPayload } | null = null
let inflight: Promise<GraphPayload> | null = null

export function invalidateGraph() {
  cache = null
  invalidateRegistry()
}

async function loadGraph(env: Record<string, string | undefined>, refresh: boolean): Promise<GraphPayload> {
  const config = readConfig(env)
  // O schema só é relido da monday em "Atualizar dados" (ou depois de uma alteração estrutural, que invalida o cache).
  const { schema } = await loadRegistry(config, env, refresh)
  const active = schema.nodeTypes.filter((t) => t.active)
  const boards = await Promise.all(active.map((t) => fetchBoard(config, t.boardId)))
  const raw: RawBoards = Object.fromEntries(active.map((t, i) => [t.slug, boards[i]]))
  return normalizeMondayGraphData(raw, schema)
}

export async function getGraph(
  env: Record<string, string | undefined>,
  refresh = false,
  ttlMs = (readConfig(env).cacheSeconds || 0) * 1000,
): Promise<{ payload: GraphPayload; hit: boolean }> {
  if (!refresh && cache && Date.now() - cache.at < ttlMs) return { payload: cache.payload, hit: true }
  inflight ??= loadGraph(env, refresh).finally(() => {
    inflight = null
  })
  const payload = await inflight
  cache = { at: Date.now(), payload }
  return { payload, hit: false }
}
