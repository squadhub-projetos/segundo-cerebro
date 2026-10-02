import type { AppData, Content, ContentStatus, ContentType, Positions, RelationType } from '../types'
import type { LiveOverlay } from '../data/merge'
import { RELATION_RULES, isCompatible } from './relations'
import { findFreePosition } from './placement'

export const STORAGE_KEY = 'squadhub:segundo-cerebro:v1'
const STORAGE_VERSION = 1

const TYPES: ContentType[] = ['criativo', 'pagina', 'curso', 'aula', 'infoproduto', 'youtube']
const STATUSES: ContentStatus[] = ['publicado', 'finalizado', 'em-producao']

export type LoadResult =
  | { kind: 'ok'; data: AppData }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isStr = (v: unknown): v is string => typeof v === 'string'

/** Valida a forma do estado salvo. Retorna os dados normalizados ou o motivo da rejeição. */
function parse(raw: unknown): AppData | string {
  if (!isObj(raw) || raw.version !== STORAGE_VERSION || !isObj(raw.data)) return 'versão incompatível'
  const { contents, relations, positions } = raw.data
  if (!Array.isArray(contents) || !Array.isArray(relations) || !isObj(positions)) return 'estrutura inválida'

  const typeById = new Map<string, ContentType>()
  for (const c of contents) {
    if (!isObj(c) || !isStr(c.id) || !isStr(c.title) || !c.title.trim()) return 'conteúdo inválido'
    if (!TYPES.includes(c.type as ContentType) || !STATUSES.includes(c.status as ContentStatus)) {
      return 'tipo ou status inválido'
    }
    if (!isStr(c.description) || !isStr(c.bodyMarkdown)) return 'texto inválido'
    if (!Array.isArray(c.themes) || !c.themes.every(isStr)) return 'temas inválidos'
    if (c.collectionId !== null && !isStr(c.collectionId)) return 'conjunto inválido'
    if (c.thumbnailPath !== null && !isStr(c.thumbnailPath)) return 'capa inválida'
    if (typeof c.isMock !== 'boolean') return 'marcação de demonstração inválida'
    if (typeById.has(c.id)) return 'IDs duplicados'
    typeById.set(c.id, c.type as ContentType)
  }

  const seen = new Set<string>()
  for (const r of relations) {
    if (!isObj(r) || !isStr(r.id) || !isStr(r.source) || !isStr(r.target) || !isStr(r.type)) {
      return 'relação inválida'
    }
    if (!(r.type in RELATION_RULES)) return 'tipo de relação inválido'
    const s = typeById.get(r.source)
    const t = typeById.get(r.target)
    if (!s || !t || r.source === r.target) return 'relação com referência inválida'
    if (!isCompatible(r.type as RelationType, s, t)) return 'relação incompatível'
    const key = `${r.source}>${r.target}>${r.type}`
    if (seen.has(key)) return 'relação duplicada'
    seen.add(key)
  }

  const clean: Positions = {}
  for (const [id, p] of Object.entries(positions)) {
    if (!typeById.has(id)) continue
    if (!isObj(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'posição inválida'
    clean[id] = { x: p.x as number, y: p.y as number }
  }
  for (const c of contents as Content[]) {
    if (!clean[c.id]) clean[c.id] = findFreePosition((contents as Content[]).filter((o) => clean[o.id]), clean, c.type)
  }
  const rawPinned = (raw.data as Record<string, unknown>).pinned
  const pinned = Array.isArray(rawPinned) ? rawPinned.filter((id): id is string => isStr(id) && typeById.has(id)) : []
  return { contents, relations, positions: clean, pinned } as AppData
}

export function loadState(): LoadResult {
  let text: string | null
  try {
    text = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { kind: 'invalid', reason: 'armazenamento local indisponível' }
  }
  if (text === null) return { kind: 'empty' }
  try {
    const result = parse(JSON.parse(text))
    return typeof result === 'string' ? { kind: 'invalid', reason: result } : { kind: 'ok', data: result }
  } catch {
    return { kind: 'invalid', reason: 'dados corrompidos' }
  }
}

/** Retorna uma mensagem de erro, ou null quando salvou. */
export function saveState(data: AppData): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data }))
    return null
  } catch (error) {
    const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
    return quota ? 'O armazenamento do navegador está cheio.' : 'O navegador não permitiu gravar os dados locais.'
  }
}

/* ---- Camada local dos dados live (posições, fixações, conteúdos e conexões criados aqui) ---- */

/**
 * Dados live: o navegador guarda SÓ layout (posições e fixações por id da monday). Conteúdos, relações e coleções nunca são
 * persistidos aqui; a monday é a fonte. Versão 2 descarta qualquer formato antigo (inclusive cópias de conteúdos).
 */
export const LIVE_STORAGE_KEY = 'squadhub:segundo-cerebro:live:v1'
export const LIVE_STORAGE_VERSION = 2
const LIVE_ID = /^(info|lesson|yt):\d+$/

export function loadLive(): LiveOverlay | null {
  try {
    const text = localStorage.getItem(LIVE_STORAGE_KEY)
    if (!text) return null
    const raw = JSON.parse(text) as Partial<LiveOverlay> | null
    if (!isObj(raw) || raw.version !== LIVE_STORAGE_VERSION || !isObj(raw.positions)) {
      localStorage.removeItem(LIVE_STORAGE_KEY)
      return null
    }
    const positions: Positions = {}
    for (const [id, p] of Object.entries(raw.positions)) {
      if (LIVE_ID.test(id) && isObj(p) && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = { x: p.x as number, y: p.y as number }
    }
    return { version: LIVE_STORAGE_VERSION, positions, pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((id): id is string => isStr(id) && LIVE_ID.test(id)) : [] }
  } catch {
    return null
  }
}

export function saveLive(overlay: LiveOverlay): string | null {
  try {
    localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(overlay))
    return null
  } catch (error) {
    const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
    return quota ? 'O armazenamento do navegador está cheio.' : 'O navegador não permitiu gravar os dados locais.'
  }
}
