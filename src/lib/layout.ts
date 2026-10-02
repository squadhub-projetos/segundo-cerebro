import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Content, Positions, Relation } from '../types'
import { sizeOf } from './dimensions'
import type { Size } from './dimensions'

interface SimNode extends SimulationNodeDatum {
  id: string
  size: Size
}

type Centers = Map<string, { x: number; y: number }>

const CLUSTER_GAP = 120
/** Folga entre caixas: cobre hover (escala), brilho e anel de seleção. */
const OVERLAP_MARGIN = 56
/** Inclinação por conjunto (rad): evita a leitura de grade e dá um ar mais orgânico. */
const CLUSTER_TILT = [-0.2, 0.16, -0.08, 0.12]

const radiusOf = (s: Size) => Math.hypot(s.w, s.h) / 2

/** Resolve sobreposição retangular empurrando pelo eixo de menor penetração. */
function resolveOverlaps(centers: Centers, sizes: Map<string, Size>, margin = OVERLAP_MARGIN) {
  const ids = [...centers.keys()]
  for (let iter = 0; iter < 400; iter++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = centers.get(ids[i])!
        const b = centers.get(ids[j])!
        const sa = sizes.get(ids[i])!
        const sb = sizes.get(ids[j])!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = (sa.w + sb.w) / 2 + margin - Math.abs(dx)
        const overlapY = (sa.h + sb.h) / 2 + margin - Math.abs(dy)
        if (overlapX > 0 && overlapY > 0) {
          moved = true
          if (overlapX < overlapY) {
            const push = overlapX / 2 + 0.5
            const dir = dx >= 0 ? 1 : -1
            a.x -= push * dir
            b.x += push * dir
          } else {
            const push = overlapY / 2 + 0.5
            const dir = dy >= 0 ? 1 : -1
            a.y -= push * dir
            b.y += push * dir
          }
        }
      }
    }
    if (!moved) break
  }
}

/** Semente estrutural: curso no centro, aulas em leque à direita, página e criativos à esquerda. */
function structuralSeeds(members: Content[], relations: Relation[]): Map<string, { x: number; y: number }> {
  const seeds = new Map<string, { x: number; y: number }>()
  const ids = new Set(members.map((m) => m.id))
  const rels = relations.filter((r) => ids.has(r.source) && ids.has(r.target))
  const fan = (list: string[], cx: number, cy: number, radius: number, side: 1 | -1, spread: number) => {
    list.forEach((id, i) => {
      if (seeds.has(id)) return
      const t = list.length === 1 ? 0 : (i / (list.length - 1) - 0.5) * 2
      const angle = t * spread
      seeds.set(id, { x: cx + side * Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
    })
  }

  // Núcleos do conjunto: curso (demonstração) ou infoproduto (dados live). Conteúdos contidos vão em leque à direita;
  // quem aponta para o núcleo (página, vídeo) fica à esquerda. Uma aula compartilhada fica com o primeiro núcleo.
  const typeOf = new Map(members.map((m) => [m.id, m.type]))
  members
    .filter((m) => m.type === 'curso' || m.type === 'infoproduto')
    .forEach((hub, k) => {
      const cx = 0
      const cy = k * 720
      seeds.set(hub.id, { x: cx, y: cy })
      const aulas = rels.filter((r) => r.source === hub.id && typeOf.get(r.target) === 'aula').map((r) => r.target)
      const paginas = rels
        .filter((r) => r.target === hub.id && (typeOf.get(r.source) === 'pagina' || typeOf.get(r.source) === 'youtube'))
        .map((r) => r.source)
      fan(aulas, cx, cy, 440, 1, 1.2)
      fan(paginas, cx, cy, 400, -1, 0.2)
      for (const pid of paginas) {
        const p = seeds.get(pid)!
        const criativos = rels.filter((r) => r.type === 'direciona-para' && r.target === pid).map((r) => r.source)
        fan(criativos, p.x, p.y, 400, -1, 1.05)
      }
    })

  // Conteúdos sem a estrutura padrão: espiral simples ao redor da origem.
  let extra = 0
  for (const m of members) {
    if (seeds.has(m.id)) continue
    const angle = extra * 2.4
    const radius = 220 + extra * 60
    seeds.set(m.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius + 400 })
    extra++
  }
  return seeds
}

/** Layout de um conjunto: sementes estruturais, relaxamento por forças e correção de colisões. */
function layoutGroup(members: Content[], relations: Relation[], tilt: number): { centers: Centers; sizes: Map<string, Size> } {
  const seeds = structuralSeeds(members, relations)
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)
  const sizes = new Map(members.map((m) => [m.id, sizeOf(m.type)]))
  const nodes: SimNode[] = members.map((m) => {
    const s = seeds.get(m.id)!
    return { id: m.id, size: sizes.get(m.id)!, x: s.x * cos - s.y * sin, y: s.x * sin + s.y * cos }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: SimulationLinkDatum<SimNode>[] = relations
    .filter((r) => byId.has(r.source) && byId.has(r.target))
    .map((r) => ({ source: r.source, target: r.target }))

  const sim = forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((n) => n.id)
        .distance((l) => {
          const a = l.source as SimNode
          const b = l.target as SimNode
          return (radiusOf(a.size) + radiusOf(b.size)) * 0.8 + 80
        })
        .strength(0.35),
    )
    .force('charge', forceManyBody().strength(-220))
    .force('collide', forceCollide<SimNode>((n) => radiusOf(n.size) * 0.72 + 14).strength(0.9).iterations(2))
    .force('x', forceX(0).strength(0.02))
    .force('y', forceY(0).strength(0.03))
    .stop()
  for (let i = 0; i < 250; i++) sim.tick()

  const centers: Centers = new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
  resolveOverlaps(centers, sizes)
  return { centers, sizes }
}

/**
 * Posições (canto superior esquerdo) para todos os conteúdos. Cada conjunto temático é resolvido
 * separadamente, com o curso como referência, e os conjuntos são dispostos em grade deslocada.
 */
export function computeLayout(contents: Content[], relations: Relation[]): Positions {
  const groups = new Map<string, Content[]>()
  for (const c of contents) {
    const key = c.collectionId ?? '__sem-conjunto'
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  if (groups.size === 0) return {}

  const laid = [...groups.values()].map((members, i) => {
    const { centers, sizes } = layoutGroup(members, relations, CLUSTER_TILT[i % CLUSTER_TILT.length])
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [id, p] of centers) {
      const s = sizes.get(id)!
      minX = Math.min(minX, p.x - s.w / 2)
      maxX = Math.max(maxX, p.x + s.w / 2)
      minY = Math.min(minY, p.y - s.h / 2)
      maxY = Math.max(maxY, p.y + s.h / 2)
    }
    return { centers, sizes, minX, minY, w: maxX - minX, h: maxY - minY }
  })

  const cols = laid.length <= 2 ? laid.length : Math.ceil(Math.sqrt(laid.length))
  const rows: (typeof laid)[] = []
  for (let i = 0; i < laid.length; i += cols) rows.push(laid.slice(i, i + cols))
  const colWidth = Math.max(...laid.map((g) => g.w))
  const rowWidths = rows.map((r) => r.length * colWidth + (r.length - 1) * CLUSTER_GAP)
  const totalW = Math.max(...rowWidths)

  const result: Positions = {}
  let cursorY = 0
  rows.forEach((row, ri) => {
    const rowH = Math.max(...row.map((g) => g.h))
    const startX = (totalW - rowWidths[ri]) / 2
    row.forEach((g, ci) => {
      const originX = startX + ci * (colWidth + CLUSTER_GAP) + (colWidth - g.w) / 2
      const originY = cursorY + (rowH - g.h) / 2
      for (const [id, p] of g.centers) {
        const s = g.sizes.get(id)!
        result[id] = {
          x: Math.round(originX + (p.x - s.w / 2 - g.minX)),
          y: Math.round(originY + (p.y - s.h / 2 - g.minY)),
        }
      }
    })
    cursorY += rowH + CLUSTER_GAP
  })
  return result
}

/** Retângulo que envolve as posições dadas (para enquadrar a câmera). */
export function boundsOf(contents: Content[], positions: Positions) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contents) {
    const p = positions[c.id]
    if (!p) continue
    const s = sizeOf(c.type)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + s.w)
    maxY = Math.max(maxY, p.y + s.h)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
