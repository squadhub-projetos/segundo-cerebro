import type { Content, Position, Positions } from '../types'
import { sizeOf } from './dimensions'
import { MARGIN_X, MARGIN_Y } from './spatial'

/** Nome da cópia: "Título — cópia", "Título — cópia 2"... sem encadear sufixos. */
export function copyTitle(title: string, existing: Set<string>): string {
  const base = title.replace(/ — cópia( \d+)?$/, '')
  let candidate = `${base} — cópia`
  for (let n = 2; existing.has(candidate); n++) candidate = `${base} — cópia ${n}`
  return candidate
}

/**
 * Deslocamento do grupo duplicado: tenta ao lado (direita, abaixo, esquerda, acima) do conjunto original, na distância
 * mínima que evita colisão com qualquer conteúdo existente, mantendo as posições relativas dentro do grupo.
 */
export function planDuplicateOffset(contents: Content[], positions: Positions, ids: string[]): Position {
  const group = contents.filter((c) => ids.includes(c.id) && positions[c.id])
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of group) {
    const p = positions[c.id]
    const s = sizeOf(c.type)
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x + s.w)
    y1 = Math.max(y1, p.y + s.h)
  }
  const w = x1 - x0
  const h = y1 - y0
  // Candidatos em anéis crescentes ao redor do original (direita e abaixo primeiro), até achar um lugar sem colisão.
  const base = Math.max(w, h) / 2 + Math.min(w, h) / 2 + 40
  const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) /2, (7 * Math.PI) / 4]
  const candidates: Position[] = []
  for (const f of [0.75, 0.95, 1.2, 1.5, 1.9, 2.4, 3]) {
    for (const a of angles) candidates.push({ x: Math.round(Math.cos(a) * base * f * 1.15), y: Math.round(Math.sin(a) * base * f * 0.85) })
  }
  const collisions = (off: Position) => {
    let count = 0
    for (const c of group) {
      const p = positions[c.id]
      const s = sizeOf(c.type)
      const cx = p.x + off.x + s.w / 2
      const cy = p.y + off.y + s.h / 2
      for (const o of contents) {
        const op = positions[o.id]
        if (!op) continue
        const os = sizeOf(o.type)
        if (Math.abs(op.x + os.w / 2 - cx) < (s.w + os.w) / 2 + MARGIN_X * 0.6 && Math.abs(op.y + os.h / 2 - cy) < (s.h + os.h) / 2 + MARGIN_Y * 0.6) count++
      }
    }
    return count
  }
  let best = candidates[0]
  let bestCount = Infinity
  for (const c of candidates) {
    const n = collisions(c)
    if (n < bestCount) {
      bestCount = n
      best = c
    }
    if (n === 0) break
  }
  return best
}
