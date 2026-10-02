export interface NodeBounds {
  x: number
  y: number
  w: number
  h: number
  /** Raio dos cantos. */
  r: number
}

export interface BoundaryHit {
  /** Ponto mais próximo sobre o contorno (mesmo espaço do ponteiro). */
  x: number
  y: number
  /** Normal externa unitária no ponto. */
  nx: number
  ny: number
  /** Distância assinada do ponteiro ao contorno: negativa dentro do card, positiva fora. */
  distance: number
}

/**
 * Projeta um ponto sobre o contorno de um retângulo com cantos arredondados (exato, sem usar 4 pontos fixos).
 * Fora do retângulo interno (encolhido pelo raio) o ponto mais próximo está a `r` do retângulo interno, o que
 * acompanha os cantos em arco; dentro dele, vale a lateral mais próxima.
 */
export function getNearestPointOnNodeBoundary(b: NodeBounds, p: { x: number; y: number }): BoundaryHit {
  const hw = b.w / 2
  const hh = b.h / 2
  const r = Math.min(b.r, hw, hh)
  const qx = p.x - (b.x + hw)
  const qy = p.y - (b.y + hh)
  const sx = qx < 0 ? -1 : 1
  const sy = qy < 0 ? -1 : 1
  const ax = Math.abs(qx)
  const ay = Math.abs(qy)
  const ix = hw - r
  const iy = hh - r
  const kx = Math.max(ax - ix, 0)
  const ky = Math.max(ay - iy, 0)
  const len = Math.hypot(kx, ky)

  let bx: number
  let by: number
  let nx: number
  let ny: number
  let distance: number
  if (len > 0) {
    nx = kx / len
    ny = ky / len
    bx = Math.min(ax, ix) + nx * r
    by = Math.min(ay, iy) + ny * r
    distance = len - r
  } else {
    const dx = hw - ax
    const dy = hh - ay
    if (dx < dy) {
      bx = hw
      by = ay
      nx = 1
      ny = 0
      distance = -dx
    } else {
      bx = ax
      by = hh
      nx = 0
      ny = 1
      distance = -dy
    }
  }
  return { x: b.x + hw + sx * bx, y: b.y + hh + sy * by, nx: sx * nx, ny: sy * ny, distance }
}
