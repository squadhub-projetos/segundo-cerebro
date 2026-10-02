export interface Pt {
  x: number
  y: number
}

/** Retângulo centrado: usado para achar onde a curva sai de um card. */
export interface Rect {
  cx: number
  cy: number
  hw: number
  hh: number
}

export interface Quad {
  a: Pt
  b: Pt
  c: Pt
}

const BEND = 0.12

/** Curva quadrática suave entre dois pontos (a origem lógica é o centro de cada card). */
export function quad(a: Pt, b: Pt, bend = BEND): Quad {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return { a, b, c: { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend } }
}

export const pathOf = (q: Quad) => `M ${q.a.x} ${q.a.y} Q ${q.c.x} ${q.c.y} ${q.b.x} ${q.b.y}`

export function pointAt(q: Quad, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * q.a.x + 2 * u * t * q.c.x + t * t * q.b.x,
    y: u * u * q.a.y + 2 * u * t * q.c.y + t * t * q.b.y,
  }
}

export function tangentAt(q: Quad, t: number): Pt {
  const u = 1 - t
  const x = 2 * u * (q.c.x - q.a.x) + 2 * t * (q.b.x - q.c.x)
  const y = 2 * u * (q.c.y - q.a.y) + 2 * t * (q.b.y - q.c.y)
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

const inside = (p: Pt, r: Rect, gap: number) => Math.abs(p.x - r.cx) <= r.hw + gap && Math.abs(p.y - r.cy) <= r.hh + gap

/**
 * Parâmetro t em que a curva deixa o retângulo, partindo do centro dele.
 * `end = false`: card de origem (t cresce a partir de 0); `end = true`: card de destino (t decresce a partir de 1).
 */
export function exitT(q: Quad, rect: Rect, end: boolean, gap = 0): number {
  const steps = 80
  let prev = end ? 1 : 0
  for (let i = 1; i <= steps; i++) {
    const t = end ? 1 - i / steps : i / steps
    if (!inside(pointAt(q, t), rect, gap)) {
      // refinamento por bisseção entre o último ponto dentro (prev) e o primeiro fora (t)
      let lo = prev
      let hi = t
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2
        if (inside(pointAt(q, mid), rect, gap)) lo = mid
        else hi = mid
      }
      return hi
    }
    prev = t
  }
  return end ? 0 : 1
}
