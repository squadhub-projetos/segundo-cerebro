import type { Content, ContentType, Position, Positions } from '../types'
import { sizeOf } from './dimensions'
import type { Size } from './dimensions'

/** Folga entre caixas (hover, brilho e anel de seleção). Igual à do layout automático. */
const MARGIN = 56

export interface PlaceOptions {
  /** Posicionar perto deste conteúdo. */
  anchorId?: string
  /** Lado preferido em relação à âncora (-1 esquerda, 1 direita). Ignorado se `angle` for dado. */
  side?: -1 | 1
  /** Direção preferida (radianos) a partir da âncora; preserva a continuidade espacial. */
  angle?: number
  /** Sem âncora: ponto do mapa (por exemplo, o centro da área visível) perto do qual surgir. */
  hint?: Position
}

const centerOf = (p: Position, s: Size) => ({ x: p.x + s.w / 2, y: p.y + s.h / 2 })

/** Verdadeiro se uma caixa de tamanho `size` centrada em `c` colide com algum conteúdo já posicionado. */
function collides(c: Position, size: Size, contents: Content[], positions: Positions) {
  return contents.some((o) => {
    const op = positions[o.id]
    if (!op) return false
    const os = sizeOf(o.type)
    const oc = centerOf(op, os)
    return Math.abs(oc.x - c.x) < (size.w + os.w) / 2 + MARGIN && Math.abs(oc.y - c.y) < (size.h + os.h) / 2 + MARGIN
  })
}

function angularDistance(a: number, b: number) {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

/**
 * Encontra uma posição livre (canto superior esquerdo) para um nó do tipo `type`, sempre o mais perto possível do contexto:
 * da âncora (conteúdo ligado), do ponto indicado (foco do usuário) ou, na falta dos dois, abaixo do conteúdo existente.
 * `contents` deve conter apenas os nós já posicionados.
 */
export function findFreePosition(
  contents: Content[],
  positions: Positions,
  type: ContentType,
  opts: PlaceOptions = {},
): Position {
  const size = sizeOf(type)
  const anchorPos = opts.anchorId ? positions[opts.anchorId] : undefined
  const anchorType = contents.find((c) => c.id === opts.anchorId)?.type

  let origin: Position | null = null
  let startRadius = 0
  if (anchorPos && anchorType) {
    const as = sizeOf(anchorType)
    origin = centerOf(anchorPos, as)
    startRadius = (as.w + size.w) / 2 + 90
  } else if (opts.hint) {
    origin = opts.hint
  }

  if (origin) {
    const preferred = opts.angle ?? ((opts.side ?? 1) === 1 ? 0 : Math.PI)
    const angles = Array.from({ length: 24 }, (_, i) => (i * Math.PI * 2) / 24).sort(
      (a, b) => angularDistance(a, preferred) - angularDistance(b, preferred),
    )
    if (startRadius === 0 && !collides(origin, size, contents, positions)) {
      return { x: Math.round(origin.x - size.w / 2), y: Math.round(origin.y - size.h / 2) }
    }
    for (let radius = startRadius || 90; radius <= 2600; radius += 70) {
      for (const angle of angles) {
        const c = { x: origin.x + Math.cos(angle) * radius * 1.1, y: origin.y + Math.sin(angle) * radius * 0.8 }
        if (!collides(c, size, contents, positions)) {
          return { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) }
        }
      }
    }
  }

  const placed = contents.filter((c) => positions[c.id])
  if (placed.length === 0) return { x: 0, y: 0 }
  const minX = Math.min(...placed.map((c) => positions[c.id].x))
  const maxY = Math.max(...placed.map((c) => positions[c.id].y + sizeOf(c.type).h))
  const candidate = { x: minX, y: maxY + 140 }
  while (collides(centerOf(candidate, size), size, contents, positions)) candidate.x += size.w + MARGIN
  return candidate
}
