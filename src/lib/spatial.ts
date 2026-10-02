import type { Content, Position, Positions, Relation } from '../types'
import { sizeOf } from './dimensions'
import type { Size } from './dimensions'

/**
 * Inteligência espacial do grafo. Três níveis, do mais local ao mais global:
 *  - placeNode: onde um nó novo (ou um nó que precisa ser re-posicionado) deve ficar, por custo;
 *  - optimizeLocalNeighborhood: depois de conectar, aproxima só o nó menos "âncora" quando a ligação ficou ruim;
 *  - organizeGraph: reorganização completa, mas gentil (parte das posições atuais e minimiza o deslocamento).
 * Todas usam as dimensões reais dos cards (src/lib/dimensions.ts) e uma margem visual mínima.
 */

/** Margem mínima entre caixas (cobre hover, brilho, anel de seleção e respiro visual). */
export const MARGIN_X = 64
export const MARGIN_Y = 52
/** Folga mínima entre conjuntos. */
export const CLUSTER_GAP = 110

type Pt = { x: number; y: number }
type Centers = Map<string, Pt>

export interface SpatialContext {
  contents: Content[]
  relations: Relation[]
  positions: Positions
  /** Nós posicionados manualmente pelo usuário (peso de fixação maior). */
  pinned: Set<string>
}

/* ------------------------------------------------------------------ geometria básica */

const centerOf = (p: Position, s: Size): Pt => ({ x: p.x + s.w / 2, y: p.y + s.h / 2 })
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

function ccw(a: Pt, b: Pt, c: Pt) {
  return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x)
}

/** Interseção própria de dois segmentos (extremos compartilhados não contam). */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = ccw(a, b, c)
  const d2 = ccw(a, b, d)
  const d3 = ccw(c, d, a)
  const d4 = ccw(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** O segmento atravessa o retângulo (encolhido por `shrink`)? Liang–Barsky. */
function segmentHitsRect(a: Pt, b: Pt, cx: number, cy: number, hw: number, hh: number, shrink = 8): boolean {
  const x0 = cx - hw + shrink
  const x1 = cx + hw - shrink
  const y0 = cy - hh + shrink
  const y1 = cy + hh - shrink
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y)
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

/* ------------------------------------------------------------------ topologia */

function adjacency(relations: Relation[]) {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }
  for (const r of relations) {
    add(r.source, r.target)
    add(r.target, r.source)
  }
  return adj
}

/** Conjunto (cluster) do conteúdo; sem conjunto, herda o de um vizinho. */
function clusterMap(contents: Content[], adj: Map<string, Set<string>>): Map<string, string> {
  const byId = new Map(contents.map((c) => [c.id, c]))
  const out = new Map<string, string>()
  for (const c of contents) {
    let key = c.collectionId
    if (!key) {
      for (const n of adj.get(c.id) ?? []) {
        const nk = byId.get(n)?.collectionId
        if (nk) {
          key = nk
          break
        }
      }
    }
    out.set(c.id, key ?? '__sem-conjunto')
  }
  return out
}

/** Comprimento de aresta "confortável" entre dois conteúdos, a partir das dimensões reais. */
export function idealDistance(a: Content, b: Content): number {
  const sa = sizeOf(a.type)
  const sb = sizeOf(b.type)
  return (sa.w + sb.w) / 2 + MARGIN_X + 40
}

/** Peso de estabilidade (0 a 1): quanto mais conexões (ou se foi posicionado à mão), menos o nó deve se mover. */
function stabilityOf(id: string, adj: Map<string, Set<string>>, pinned: Set<string>) {
  const degree = adj.get(id)?.size ?? 0
  const base = Math.min(1, 0.2 + 0.18 * degree)
  return pinned.has(id) ? Math.max(base, 0.9) : base
}

/* ------------------------------------------------------------------ colisões */

/** Resolve sobreposição retangular (com margem). Nós mais estáveis cedem menos. */
function resolveCollisions(centers: Centers, sizes: Map<string, Size>, weights: Map<string, number>) {
  const ids = [...centers.keys()]
  for (let iter = 0; iter < 300; iter++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = centers.get(ids[i])!
        const b = centers.get(ids[j])!
        const sa = sizes.get(ids[i])!
        const sb = sizes.get(ids[j])!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const ox = (sa.w + sb.w) / 2 + MARGIN_X - Math.abs(dx)
        const oy = (sa.h + sb.h) / 2 + MARGIN_Y - Math.abs(dy)
        if (ox <= 0 || oy <= 0) continue
        moved = true
        const wa = 0.1 + (weights.get(ids[i]) ?? 0.3)
        const wb = 0.1 + (weights.get(ids[j]) ?? 0.3)
        const ma = wb / (wa + wb)
        const mb = wa / (wa + wb)
        if (ox < oy) {
          const dir = dx >= 0 ? 1 : -1
          a.x -= (ox + 0.5) * ma * dir
          b.x += (ox + 0.5) * mb * dir
        } else {
          const dir = dy >= 0 ? 1 : -1
          a.y -= (oy + 0.5) * ma * dir
          b.y += (oy + 0.5) * mb * dir
        }
      }
    }
    if (!moved) break
  }
}

function boxCollides(c: Pt, size: Size, others: { id: string; c: Pt; s: Size }[]) {
  return others.some(
    (o) => Math.abs(o.c.x - c.x) < (size.w + o.s.w) / 2 + MARGIN_X && Math.abs(o.c.y - c.y) < (size.h + o.s.h) / 2 + MARGIN_Y,
  )
}

/* ------------------------------------------------------------------ custo de layout */

interface CostParts {
  length: number
  crossing: number
  collision: number
  spread: number
  movement: number
  total: number
}

/**
 * Custo global de uma disposição: arestas longas, cruzamentos/atravessamentos, colisões, dispersão dos conjuntos
 * e deslocamento em relação às posições originais.
 */
export function layoutCost(ctx: SpatialContext, positions: Positions, original?: Positions): CostParts {
  const { contents, relations, pinned } = ctx
  const byId = new Map(contents.map((c) => [c.id, c]))
  const adj = adjacency(relations)
  const cluster = clusterMap(contents, adj)
  const centers = new Map<string, Pt>()
  for (const c of contents) {
    const p = positions[c.id]
    if (p) centers.set(c.id, centerOf(p, sizeOf(c.type)))
  }

  let length = 0
  const segs: { a: string; b: string; pa: Pt; pb: Pt }[] = []
  for (const r of relations) {
    const pa = centers.get(r.source)
    const pb = centers.get(r.target)
    if (!pa || !pb) continue
    segs.push({ a: r.source, b: r.target, pa, pb })
    if (cluster.get(r.source) !== cluster.get(r.target)) continue
    const ideal = idealDistance(byId.get(r.source)!, byId.get(r.target)!)
    const excess = Math.max(0, dist(pa, pb) / ideal - 1.25)
    length += excess * excess * 2
  }

  let crossing = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]
      const t = segs[j]
      if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue
      if (segmentsCross(s.pa, s.pb, t.pa, t.pb)) crossing += 1.5
    }
    for (const c of contents) {
      if (c.id === segs[i].a || c.id === segs[i].b) continue
      const cc = centers.get(c.id)
      if (!cc) continue
      const s = sizeOf(c.type)
      if (segmentHitsRect(segs[i].pa, segs[i].pb, cc.x, cc.y, s.w / 2, s.h / 2)) crossing += 2
    }
  }

  let collision = 0
  const list = contents.filter((c) => centers.has(c.id))
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = centers.get(list[i].id)!
      const b = centers.get(list[j].id)!
      const sa = sizeOf(list[i].type)
      const sb = sizeOf(list[j].type)
      if (Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 + MARGIN_X * 0.6 && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2 + MARGIN_Y * 0.6) collision += 10
    }
  }

  let spread = 0
  const groups = new Map<string, Content[]>()
  for (const c of list) groups.set(cluster.get(c.id)!, [...(groups.get(cluster.get(c.id)!) ?? []), c])
  for (const members of groups.values()) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let area = 0
    for (const m of members) {
      const c = centers.get(m.id)!
      const s = sizeOf(m.type)
      x0 = Math.min(x0, c.x - s.w / 2)
      x1 = Math.max(x1, c.x + s.w / 2)
      y0 = Math.min(y0, c.y - s.h / 2)
      y1 = Math.max(y1, c.y + s.h / 2)
      area += s.w * s.h
    }
    spread += ((x1 - x0) * (y1 - y0)) / (area * 3)
  }

  let movement = 0
  if (original) {
    for (const c of contents) {
      const p = positions[c.id]
      const o = original[c.id]
      if (!p || !o) continue
      movement += (Math.hypot(p.x - o.x, p.y - o.y) / 400) * (0.3 + stabilityOf(c.id, adj, pinned))
    }
  }
  return { length, crossing, collision, spread: spread * 0.3, movement, total: length + crossing + collision + spread * 0.3 + movement }
}

/* ------------------------------------------------------------------ colocação por custo */

export interface PlaceRequest {
  /** Conteúdo a posicionar (já com `collectionId`). Se já existir em `positions`, deve ser removido antes pelo chamador. */
  content: Content
  /** Vínculos do conteúdo (inclusive os recém-criados). */
  relations: Relation[]
  /** Ponto do mapa perto do foco do usuário, usado quando não há vizinhos. */
  hint?: Position
  /** Posição atual (re-posicionamento): entra como custo de deslocamento. */
  current?: Position
}

export interface Placement {
  position: Position
  cost: number
}

const RADII = [0.85, 1.0, 1.2, 1.45, 1.75, 2.1, 2.5, 3]
const ANGLES = 24

/** Custo de colocar o conteúdo com o centro em `c` (sem colisão), dado o contexto. */
function evaluate(ctx: SpatialContext, req: PlaceRequest, c: Pt, neighbors: Content[], core: Pt | null): number {
  const { contents, relations, positions } = ctx
  const s = sizeOf(req.content.type)
  const byId = new Map(contents.map((x) => [x.id, x]))
  const adj = adjacency([...relations, ...req.relations])
  const clusterKey = clusterMap([...contents, req.content], adj).get(req.content.id)!
  const cluster = clusterMap([...contents, req.content], adj)

  let cost = 0
  const myCenter = c

  // 1. Comprimento das conexões diretas (quanto mais perto do ideal, melhor).
  for (const n of neighbors) {
    const np = positions[n.id]
    if (!np) continue
    const nc = centerOf(np, sizeOf(n.type))
    const ratio = dist(c, nc) / idealDistance(req.content, n)
    cost += ratio * 2 + Math.max(0, ratio - 1.15) ** 2 * 6
  }

  // 2. Cruzamentos e atravessamentos pelas novas arestas; e arestas existentes passando por cima do novo card.
  const newSegs = neighbors
    .filter((n) => positions[n.id])
    .map((n) => ({ id: n.id, a: myCenter, b: centerOf(positions[n.id], sizeOf(n.type)) }))
  const existing = relations
    .filter((r) => positions[r.source] && positions[r.target])
    .map((r) => ({
      s: r.source,
      t: r.target,
      a: centerOf(positions[r.source], sizeOf(byId.get(r.source)!.type)),
      b: centerOf(positions[r.target], sizeOf(byId.get(r.target)!.type)),
    }))
  for (const ns of newSegs) {
    for (const e of existing) {
      if (e.s === ns.id || e.t === ns.id) continue
      if (segmentsCross(ns.a, ns.b, e.a, e.b)) cost += 3
    }
    for (const o of contents) {
      if (o.id === ns.id || !positions[o.id]) continue
      const oc = centerOf(positions[o.id], sizeOf(o.type))
      const os = sizeOf(o.type)
      if (segmentHitsRect(ns.a, ns.b, oc.x, oc.y, os.w / 2, os.h / 2)) cost += 4
    }
  }
  for (const e of existing) {
    if (segmentHitsRect(e.a, e.b, c.x, c.y, s.w / 2, s.h / 2)) cost += 3
  }

  // 3. Aglomeração angular: prefira um setor livre ao redor dos vizinhos.
  for (const n of neighbors) {
    const np = positions[n.id]
    if (!np) continue
    const nc = centerOf(np, sizeOf(n.type))
    const theta = Math.atan2(c.y - nc.y, c.x - nc.x)
    for (const m of adj.get(n.id) ?? []) {
      if (m === req.content.id || !positions[m]) continue
      const mc = centerOf(positions[m], sizeOf(byId.get(m)!.type))
      const phi = Math.atan2(mc.y - nc.y, mc.x - nc.x)
      cost += 1.5 * Math.exp(-((angleDiff(theta, phi) / 0.45) ** 2))
    }
  }

  // 4. Expansão do conjunto e equilíbrio em torno do núcleo.
  const members = contents.filter((o) => positions[o.id] && cluster.get(o.id) === clusterKey)
  if (members.length > 0) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const m of members) {
      const mc = centerOf(positions[m.id], sizeOf(m.type))
      const ms = sizeOf(m.type)
      x0 = Math.min(x0, mc.x - ms.w / 2)
      x1 = Math.max(x1, mc.x + ms.w / 2)
      y0 = Math.min(y0, mc.y - ms.h / 2)
      y1 = Math.max(y1, mc.y + ms.h / 2)
    }
    const before = (x1 - x0) * (y1 - y0)
    const nx0 = Math.min(x0, c.x - s.w / 2)
    const nx1 = Math.max(x1, c.x + s.w / 2)
    const ny0 = Math.min(y0, c.y - s.h / 2)
    const ny1 = Math.max(y1, c.y + s.h / 2)
    cost += (((nx1 - nx0) * (ny1 - ny0) - before) / before) * 1.2
    if (core) {
      let sx = c.x
      let sy = c.y
      for (const m of members) {
        const mc = centerOf(positions[m.id], sizeOf(m.type))
        sx += mc.x
        sy += mc.y
      }
      const centroid = { x: sx / (members.length + 1), y: sy / (members.length + 1) }
      cost += (dist(centroid, core) / 400) * 0.8
    }
  }

  // 5. Foco do usuário e estabilidade.
  if (req.hint) cost += (dist(c, req.hint) / 1000) * 0.4
  if (req.current) {
    const cur = centerOf(req.current, s)
    const stab = ctx.pinned.has(req.content.id) ? 1.2 : 0.35
    cost += (dist(c, cur) / 400) * stab
  }
  return cost
}

/**
 * Escolhe a melhor posição (menor custo, sem colisão) para um conteúdo. Candidatos: ao redor de cada vizinho, em
 * vários raios proporcionais às dimensões reais e 24 direções; sem vizinhos, ao redor do foco (hint).
 */
export function placeNode(ctx: SpatialContext, req: PlaceRequest): Placement {
  const { contents, positions } = ctx
  const s = sizeOf(req.content.type)
  const byId = new Map(contents.map((c) => [c.id, c]))
  const others = contents
    .filter((c) => c.id !== req.content.id && positions[c.id])
    .map((c) => ({ id: c.id, c: centerOf(positions[c.id], sizeOf(c.type)), s: sizeOf(c.type) }))

  const neighborIds = new Set<string>()
  for (const r of req.relations) {
    if (r.source === req.content.id) neighborIds.add(r.target)
    if (r.target === req.content.id) neighborIds.add(r.source)
  }
  const neighbors = [...neighborIds].map((id) => byId.get(id)).filter((c): c is Content => Boolean(c && positions[c.id]))

  // Núcleo do conjunto: o membro com mais conexões.
  const adj = adjacency([...ctx.relations, ...req.relations])
  const clusters = clusterMap([...contents, req.content], adj)
  const myCluster = clusters.get(req.content.id)
  let core: Pt | null = null
  let best = -1
  for (const c of contents) {
    if (!positions[c.id] || clusters.get(c.id) !== myCluster) continue
    const deg = adj.get(c.id)?.size ?? 0
    if (deg > best) {
      best = deg
      core = centerOf(positions[c.id], sizeOf(c.type))
    }
  }

  let bestPos: Pt | null = null
  let bestCost = Infinity
  const consider = (c: Pt) => {
    if (boxCollides(c, s, others)) return
    const cost = evaluate(ctx, req, c, neighbors, core)
    if (cost < bestCost) {
      bestCost = cost
      bestPos = c
    }
  }

  if (neighbors.length > 0) {
    for (const n of neighbors) {
      const nc = centerOf(positions[n.id], sizeOf(n.type))
      const ideal = idealDistance(req.content, n)
      for (const f of RADII) {
        for (let k = 0; k < ANGLES; k++) {
          const a = (k * Math.PI * 2) / ANGLES
          consider({ x: nc.x + Math.cos(a) * ideal * f * 1.05, y: nc.y + Math.sin(a) * ideal * f * 0.8 })
        }
        // O primeiro anel com candidato válido costuma bastar; continuar só se nada coube.
        if (bestPos && f >= 1.45) break
      }
    }
  } else {
    const origin = req.hint ?? (req.current ? centerOf(req.current, s) : null)
    if (origin) {
      consider(origin)
      for (let r = 90; r <= 2400 && !bestPos; r += 80) {
        for (let k = 0; k < ANGLES; k++) {
          const a = (k * Math.PI * 2) / ANGLES
          consider({ x: origin.x + Math.cos(a) * r * 1.1, y: origin.y + Math.sin(a) * r * 0.8 })
        }
      }
    }
  }

  if (!bestPos) {
    // Último recurso: abaixo do conteúdo existente.
    const placed = others
    if (placed.length === 0) return { position: { x: 0, y: 0 }, cost: 0 }
    const minX = Math.min(...placed.map((o) => o.c.x - o.s.w / 2))
    const maxY = Math.max(...placed.map((o) => o.c.y + o.s.h / 2))
    const c = { x: minX + s.w / 2, y: maxY + 140 + s.h / 2 }
    while (boxCollides(c, s, others)) c.x += s.w + MARGIN_X
    return { position: { x: Math.round(c.x - s.w / 2), y: Math.round(c.y - s.h / 2) }, cost: 99 }
  }
  const chosen: Pt = bestPos
  return { position: { x: Math.round(chosen.x - s.w / 2), y: Math.round(chosen.y - s.h / 2) }, cost: bestCost }
}

/** Razão comprimento/ideal da pior conexão do nó dentro do próprio conjunto. */
function worstEdgeRatio(ctx: SpatialContext, id: string, positions: Positions): number {
  const { contents, relations } = ctx
  const byId = new Map(contents.map((c) => [c.id, c]))
  const cluster = clusterMap(contents, adjacency(relations))
  let worst = 0
  for (const r of relations) {
    if (r.source !== id && r.target !== id) continue
    if (cluster.get(r.source) !== cluster.get(r.target)) continue
    const a = byId.get(r.source)
    const b = byId.get(r.target)
    if (!a || !b || !positions[a.id] || !positions[b.id]) continue
    worst = Math.max(worst, dist(centerOf(positions[a.id], sizeOf(a.type)), centerOf(positions[b.id], sizeOf(b.type))) / idealDistance(a, b))
  }
  return worst
}

/** Razão mediana das conexões do nó: um núcleo só é "mal posicionado" se a maioria das suas conexões estiver longa. */
function medianEdgeRatio(ctx: SpatialContext, id: string, positions: Positions): number {
  const { contents, relations } = ctx
  const byId = new Map(contents.map((c) => [c.id, c]))
  const cluster = clusterMap(contents, adjacency(relations))
  const ratios: number[] = []
  for (const r of relations) {
    if (r.source !== id && r.target !== id) continue
    if (cluster.get(r.source) !== cluster.get(r.target)) continue
    const a = byId.get(r.source)
    const b = byId.get(r.target)
    if (!a || !b || !positions[a.id] || !positions[b.id]) continue
    ratios.push(dist(centerOf(positions[a.id], sizeOf(a.type)), centerOf(positions[b.id], sizeOf(b.type))) / idealDistance(a, b))
  }
  if (ratios.length === 0) return 0
  ratios.sort((x, y) => x - y)
  return ratios[Math.floor(ratios.length / 2)]
}

/**
 * Tenta re-posicionar UM nó perto dos seus vizinhos, comparando o custo de ficar com o de mover (que inclui o deslocamento).
 * Nós âncora (muitas conexões ou posicionados à mão) só se movem se a pior conexão estiver absurdamente longa.
 * Retorna as novas posições ou null.
 */
function replaceNode(ctx: SpatialContext, id: string): Positions | null {
  const { contents, relations, positions, pinned } = ctx
  const node = contents.find((c) => c.id === id)
  if (!node || !positions[id]) return null
  const adj = adjacency(relations)
  const stab = stabilityOf(id, adj, pinned)
  if (stab >= 0.75 && medianEdgeRatio(ctx, id, positions) < 2.2) return null

  const own = relations.filter((r) => r.source === id || r.target === id)
  const rest = { ...positions }
  delete rest[id]
  const restCtx: SpatialContext = {
    ...ctx,
    positions: rest,
    contents: contents.filter((c) => c.id !== id),
    relations: relations.filter((r) => r.source !== id && r.target !== id),
  }
  const req: PlaceRequest = { content: node, relations: own, current: positions[id] }
  const neighbors = own
    .map((r) => contents.find((c) => c.id === (r.source === id ? r.target : r.source)))
    .filter((c): c is Content => Boolean(c))
  const clusters = clusterMap(contents, adj)
  let core: Pt | null = null
  let bestDeg = -1
  for (const c of contents) {
    if (c.id === id || clusters.get(c.id) !== clusters.get(id)) continue
    const deg = adj.get(c.id)?.size ?? 0
    if (deg > bestDeg) {
      bestDeg = deg
      core = centerOf(positions[c.id], sizeOf(c.type))
    }
  }
  const stay = evaluate(restCtx, req, centerOf(positions[id], sizeOf(node.type)), neighbors, core)
  const moved = placeNode(restCtx, req)
  if (moved.cost < stay - Math.max(0.3, stay * 0.1)) return { ...positions, [id]: moved.position }
  return null
}

/**
 * Depois de conectar A e B: se a ligação ficou ruim (longa, cruzando coisas), re-posiciona SÓ o nó menos estável,
 * perto do outro. Só aceita se o custo melhorar de forma clara. Retorna null se nada muda.
 */
export function optimizeLocalNeighborhood(ctx: SpatialContext, aId: string, bId: string): Positions | null {
  const { contents, relations, positions, pinned } = ctx
  if (!contents.some((c) => c.id === aId) || !contents.some((c) => c.id === bId) || !positions[aId] || !positions[bId]) return null
  const adj = adjacency(relations)
  const mover = stabilityOf(aId, adj, pinned) <= stabilityOf(bId, adj, pinned) ? aId : bId
  return replaceNode(ctx, mover)
}

/* ------------------------------------------------------------------ reorganização gentil */

/** Alvos radiais/semirradiais: vizinhos de núcleos densos distribuídos por setores angulares, preservando a ordem cíclica. */
function radialTargets(
  ctx: SpatialContext,
  centers: Centers,
  adj: Map<string, Set<string>>,
  cluster: Map<string, string>,
  only?: Set<string>,
) {
  const { contents, pinned } = ctx
  const byId = new Map(contents.map((c) => [c.id, c]))
  const targets = new Map<string, Pt>()
  const assigned = new Set<string>()
  const cores = contents
    .filter((c) => (adj.get(c.id)?.size ?? 0) >= 3)
    .filter((c) => !only || only.has(c.id))
    .sort((x, y) => (adj.get(y.id)?.size ?? 0) - (adj.get(x.id)?.size ?? 0))
  const coreSet = new Set<string>()

  for (const core of cores) {
    const cc = centers.get(core.id)!
    const members = [...(adj.get(core.id) ?? [])].filter((id) => cluster.get(id) === cluster.get(core.id) && centers.has(id))
    const fixed = members.filter((id) => assigned.has(id) || coreSet.has(id) || stabilityOf(id, adj, pinned) >= 0.9)
    const movable = members.filter((id) => !fixed.includes(id))
    coreSet.add(core.id)
    if (movable.length === 0) continue

    const angleOf = (id: string) => Math.atan2(centers.get(id)!.y - cc.y, centers.get(id)!.x - cc.x)
    const slots: number[] = []
    const order = [...movable]
    if (fixed.length > 0) {
      // Semirradial: os móveis ocupam o arco oposto ao lado dos vizinhos fixos (o "pai").
      const sx = fixed.reduce((acc, id) => acc + Math.cos(angleOf(id)), 0)
      const sy = fixed.reduce((acc, id) => acc + Math.sin(angleOf(id)), 0)
      const parent = Math.atan2(sy, sx)
      const rel = (id: string) => (((angleOf(id) - parent) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      order.sort((p, q) => rel(p) - rel(q))
      const A0 = 0.55
      const L = Math.PI * 2 - 2 * A0
      order.forEach((_, j) => slots.push(parent + A0 + ((j + 0.5) * L) / order.length))
    } else {
      // Raiz: círculo completo, com a rotação que menos desloca os nós.
      order.sort((p, q) => angleOf(p) - angleOf(q))
      const step = (Math.PI * 2) / order.length
      let bestOff = 0
      let bestSum = Infinity
      for (let k = 0; k < 36; k++) {
        const off = (k * Math.PI * 2) / 36
        const sum = order.reduce((acc, id, j) => acc + angleDiff(angleOf(id), off + j * step), 0)
        if (sum < bestSum) {
          bestSum = sum
          bestOff = off
        }
      }
      order.forEach((_, j) => slots.push(bestOff + j * step))
    }

    order.forEach((id, j) => {
      const n = byId.get(id)!
      const ideal = idealDistance(core, n)
      const cur = dist(cc, centers.get(id)!)
      const r = Math.min(Math.max(cur, ideal * 0.95), ideal * 1.45)
      targets.set(id, { x: cc.x + Math.cos(slots[j]) * r * 1.1, y: cc.y + Math.sin(slots[j]) * r * 0.82 })
      assigned.add(id)
    })
  }
  return targets
}

export interface OrganizeResult {
  positions: Positions
  before: CostParts
  after: CostParts
}

/** Quão mal posicionado está o nó: conexões longas, cruzamentos e colisões em que ele participa. */
function badness(ctx: SpatialContext, id: string, positions: Positions): number {
  const { contents, relations } = ctx
  const byId = new Map(contents.map((c) => [c.id, c]))
  const me = byId.get(id)
  if (!me || !positions[id]) return 0
  const mc = centerOf(positions[id], sizeOf(me.type))
  const ms = sizeOf(me.type)
  let bad = Math.max(0, worstEdgeRatio(ctx, id, positions) - 1.3) * 3
  for (const o of contents) {
    if (o.id === id || !positions[o.id]) continue
    const os = sizeOf(o.type)
    const oc = centerOf(positions[o.id], os)
    if (Math.abs(oc.x - mc.x) < (ms.w + os.w) / 2 + MARGIN_X * 0.6 && Math.abs(oc.y - mc.y) < (ms.h + os.h) / 2 + MARGIN_Y * 0.6) bad += 2
  }
  const mine = relations.filter((r) => r.source === id || r.target === id)
  for (const r of mine) {
    const a = centerOf(positions[r.source], sizeOf(byId.get(r.source)!.type))
    const b = centerOf(positions[r.target], sizeOf(byId.get(r.target)!.type))
    for (const q of relations) {
      if (q.source === r.source || q.source === r.target || q.target === r.source || q.target === r.target) continue
      const c = centerOf(positions[q.source], sizeOf(byId.get(q.source)!.type))
      const d = centerOf(positions[q.target], sizeOf(byId.get(q.target)!.type))
      if (segmentsCross(a, b, c, d)) bad += 0.8
    }
    for (const o of contents) {
      if (o.id === r.source || o.id === r.target || !positions[o.id]) continue
      const os = sizeOf(o.type)
      const oc = centerOf(positions[o.id], os)
      if (segmentHitsRect(a, b, oc.x, oc.y, os.w / 2, os.h / 2)) bad += 1
    }
  }
  return bad
}

/**
 * Reorganiza o grafo de forma gentil e local. Em vez de recalcular tudo:
 *  1. repara os nós mal posicionados (conexão longa, colisão, cruzamento), um a um, por custo (placeNode), do pior para o melhor;
 *  2. redistribui por setores angulares os vizinhos de núcleos apinhados;
 *  3. resolve colisões com margem (nós âncora cedem menos) e afasta conjuntos entre si.
 * Nós âncora (muitos vínculos ou posicionados à mão) quase não se mexem. Retorna null quando o ganho não compensa.
 */
export function organizeGraph(ctx: SpatialContext, opts: { minGain?: number } = {}): OrganizeResult | null {
  const { contents, relations, pinned } = ctx
  const placed = contents.filter((c) => ctx.positions[c.id])
  if (placed.length < 2) return null
  let positions: Positions = { ...ctx.positions }

  // 1a. Primeiro, as conexões longas: para cada uma, quem se move é a ponta MENOS estável (um núcleo nunca é puxado
  // por um satélite fora do lugar). Da pior conexão para a melhor.
  const adj0 = adjacency(relations)
  const cluster0 = clusterMap(contents, adj0)
  const byId0 = new Map(contents.map((c) => [c.id, c]))
  for (let round = 0; round < 8; round++) {
    const longEdges = relations
      .filter((r) => positions[r.source] && positions[r.target] && cluster0.get(r.source) === cluster0.get(r.target))
      .map((r) => {
        const a = byId0.get(r.source)!
        const b = byId0.get(r.target)!
        const ratio = dist(centerOf(positions[a.id], sizeOf(a.type)), centerOf(positions[b.id], sizeOf(b.type))) / idealDistance(a, b)
        const mover = stabilityOf(a.id, adj0, pinned) <= stabilityOf(b.id, adj0, pinned) ? a.id : b.id
        return { mover, ratio }
      })
      .filter((e) => e.ratio > 1.4)
      .sort((x, y) => y.ratio - x.ratio)
    const seen = new Set<string>()
    let changed = false
    for (const { mover } of longEdges) {
      if (seen.has(mover) || seen.size >= 4) continue
      seen.add(mover)
      const next = replaceNode({ ...ctx, positions }, mover)
      if (next) {
        positions = next
        changed = true
      }
    }
    if (!changed) break
  }

  // 1b. Depois, o que ainda estiver colidindo ou cruzando, do pior para o melhor.
  for (let round = 0; round < 12; round++) {
    const ranked = placed
      .map((c) => ({ id: c.id, bad: badness({ ...ctx, positions }, c.id, positions) }))
      .filter((x) => x.bad > 1)
      .sort((a, b) => b.bad - a.bad)
    if (ranked.length === 0) break
    let changed = false
    for (const { id } of ranked.slice(0, 5)) {
      const next = replaceNode({ ...ctx, positions }, id)
      if (next) {
        positions = next
        changed = true
      }
    }
    if (!changed) break
  }

  const adj = adjacency(relations)
  const cluster = clusterMap(contents, adj)
  const sizes = new Map(placed.map((c) => [c.id, sizeOf(c.type)]))
  const centers: Centers = new Map(placed.map((c) => [c.id, centerOf(positions[c.id], sizeOf(c.type))]))
  const weights = new Map(placed.map((c) => [c.id, stabilityOf(c.id, adj, pinned)]))

  // 2. Núcleos apinhados: vizinhos móveis vão para setores angulares livres (movimento parcial).
  const crowded = new Set<string>()
  for (const core of placed) {
    const members = [...(adj.get(core.id) ?? [])].filter((id) => cluster.get(id) === cluster.get(core.id) && centers.has(id))
    if (members.length < 4) continue
    const cc = centers.get(core.id)!
    const angles = members.map((id) => Math.atan2(centers.get(id)!.y - cc.y, centers.get(id)!.x - cc.x)).sort((a, b) => a - b)
    let minGapAngle = Math.PI * 2
    for (let i = 0; i < angles.length; i++) {
      const next = angles[(i + 1) % angles.length] + (i + 1 === angles.length ? Math.PI * 2 : 0)
      minGapAngle = Math.min(minGapAngle, next - angles[i])
    }
    if (minGapAngle < 0.3 * ((Math.PI * 2) / members.length)) crowded.add(core.id)
  }
  if (crowded.size > 0) {
    const targets = radialTargets(ctx, centers, adj, cluster, crowded)
    for (const [id, t] of targets) {
      if ((weights.get(id) ?? 0) >= 0.75) continue
      const c = centers.get(id)!
      c.x += (t.x - c.x) * 0.75
      c.y += (t.y - c.y) * 0.75
    }
  }

  // 3. Colisões com margem; separação entre conjuntos; colisões de novo.
  resolveCollisions(centers, sizes, weights)
  separateClusters(centers, sizes, cluster, weights)
  resolveCollisions(centers, sizes, weights)

  const next: Positions = { ...ctx.positions }
  for (const c of placed) {
    const p = centers.get(c.id)!
    const s = sizes.get(c.id)!
    next[c.id] = { x: Math.round(p.x - s.w / 2), y: Math.round(p.y - s.h / 2) }
  }
  const before = layoutCost(ctx, ctx.positions, ctx.positions)
  const after = layoutCost(ctx, next, ctx.positions)
  if (before.total - after.total < Math.max(opts.minGain ?? 0.5, before.total * 0.04)) return null
  return { positions: next, before, after }
}

/** Mantém folga entre conjuntos: o conjunto mais leve (menos nós/estabilidade) é deslocado inteiro. */
function separateClusters(centers: Centers, sizes: Map<string, Size>, cluster: Map<string, string>, weights: Map<string, number>) {
  const groups = new Map<string, string[]>()
  for (const id of centers.keys()) groups.set(cluster.get(id)!, [...(groups.get(cluster.get(id)!) ?? []), id])
  const keys = [...groups.keys()]
  // Caixa "robusta" do conjunto: ignora nós muito afastados do núcleo (por exemplo, arrastados à mão), para que um
  // único nó fora do lugar não faça o conjunto inteiro ser empurrado.
  const robust = (ids: string[]) => {
    if (ids.length < 4) return ids
    const cx = ids.reduce((acc, id) => acc + centers.get(id)!.x, 0) / ids.length
    const cy = ids.reduce((acc, id) => acc + centers.get(id)!.y, 0) / ids.length
    const d = ids.map((id) => Math.hypot(centers.get(id)!.x - cx, centers.get(id)!.y - cy)).sort((a, b) => a - b)
    const limit = d[Math.floor(d.length / 2)] * 1.9 + 120
    const kept = ids.filter((id) => Math.hypot(centers.get(id)!.x - cx, centers.get(id)!.y - cy) <= limit)
    return kept.length >= 2 ? kept : ids
  }
  const box = (all: string[]) => {
    const ids = robust(all)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const id of ids) {
      const c = centers.get(id)!
      const s = sizes.get(id)!
      x0 = Math.min(x0, c.x - s.w / 2)
      x1 = Math.max(x1, c.x + s.w / 2)
      y0 = Math.min(y0, c.y - s.h / 2)
      y1 = Math.max(y1, c.y + s.h / 2)
    }
    return { x0, y0, x1, y1 }
  }
  const mass = (ids: string[]) => ids.reduce((acc, id) => acc + 0.5 + (weights.get(id) ?? 0.3), 0)
  for (let iter = 0; iter < 30; iter++) {
    let moved = false
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const A = groups.get(keys[i])!
        const B = groups.get(keys[j])!
        const a = box(A)
        const b = box(B)
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + CLUSTER_GAP
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + CLUSTER_GAP
        if (ox <= 0 || oy <= 0) continue
        moved = true
        const ma = mass(A)
        const mb = mass(B)
        const shareA = mb / (ma + mb)
        const shareB = ma / (ma + mb)
        const acx = (a.x0 + a.x1) / 2
        const bcx = (b.x0 + b.x1) / 2
        const acy = (a.y0 + a.y1) / 2
        const bcy = (b.y0 + b.y1) / 2
        const horizontal = ox < oy
        const dirA = horizontal ? (acx <= bcx ? -1 : 1) : acy <= bcy ? -1 : 1
        const amount = (horizontal ? ox : oy) + 1
        for (const id of A) {
          const c = centers.get(id)!
          if (horizontal) c.x += dirA * amount * shareA
          else c.y += dirA * amount * shareA
        }
        for (const id of B) {
          const c = centers.get(id)!
          if (horizontal) c.x -= dirA * amount * shareB
          else c.y -= dirA * amount * shareB
        }
      }
    }
    if (!moved) break
  }
}

/* ------------------------------------------------------------------ medições úteis */

/** Menor folga entre duas caixas quaisquer (px de mapa). Negativo = sobreposição. Usado em testes. */
export function minGap(contents: Content[], positions: Positions): number {
  let min = Infinity
  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 1; j < contents.length; j++) {
      const a = positions[contents[i].id]
      const b = positions[contents[j].id]
      if (!a || !b) continue
      const sa = sizeOf(contents[i].type)
      const sb = sizeOf(contents[j].type)
      const gx = Math.abs(a.x + sa.w / 2 - (b.x + sb.w / 2)) - (sa.w + sb.w) / 2
      const gy = Math.abs(a.y + sa.h / 2 - (b.y + sb.h / 2)) - (sa.h + sb.h) / 2
      min = Math.min(min, Math.max(gx, gy))
    }
  }
  return min
}

/** Conjunto de cada conteúdo (conteúdo sem conjunto herda o de um vizinho). Usado também para os títulos dos grupos. */
export function clusterAssignments(contents: Content[], relations: Relation[]): Map<string, string> {
  return clusterMap(contents, adjacency(relations))
}
