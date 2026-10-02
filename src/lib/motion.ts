/** Durações (ms) e easing reutilizáveis. As mesmas faixas existem como variáveis em tokens.css. */
export const MOTION = {
  hover: 180,
  hoverLeaveDelay: 90,
  panel: 260,
  /** Presença na busca: saída 220 ms, entrada 280 ms (espelham --dur-exit/--dur-enter). */
  exit: 220,
  enter: 280,
  searchDebounce: 150,
  camera: 450,
  relayout: 600,
} as const

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Duração efetiva: zero quando o usuário prefere menos movimento. */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
