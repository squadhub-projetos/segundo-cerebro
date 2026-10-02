import { useEffect, useRef, useState } from 'react'
import { ViewportPortal, useStoreApi } from '@xyflow/react'
import type { Content, Positions, Relation } from '../types'
import { getNearestPointOnNodeBoundary } from '../lib/boundary'
import type { BoundaryHit } from '../lib/boundary'
import { NODE_RADIUS, sizeOf } from '../lib/dimensions'
import { prefersReducedMotion } from '../lib/motion'
import { inferRelation } from '../lib/relations'
import { CONNECTION_INTERACTION_MIN_ZOOM } from '../lib/zoom'

/** Faixa de interação em px de TELA (convertida pelo zoom): para dentro e para fora do contorno. */
const INNER_PX = 10
const OUTER_PX = 14
/** Alcance do ímã sobre o alvo (px de tela): qualquer ponto até aqui da borda, ou dentro do card, encaixa. */
const MAGNET_PX = 30
/** A faixa interna nunca passa desta fração do menor lado, para sobrar centro livre para arrastar o card. */
const MAX_INNER_FRACTION = 0.22

interface Props {
  contents: Content[]
  relations: Relation[]
  positions: Positions
  presentIds: Set<string>
  selectedId: string | null
  onConnect: (aId: string, bId: string) => void
  onNotify: (message: string) => void
  /** Avisa o grafo quando uma conexão começa/termina (limpa o hover, por exemplo). */
  onBusy: (busy: boolean) => void
}

interface Hit {
  id: string
  hit: BoundaryHit
}

interface Gesture {
  from: string
  origin: BoundaryHit
  end: { x: number; y: number }
  endNormal: { nx: number; ny: number } | null
  snapped: boolean
  target: string | null
  candidateId: string | null
  reason: string | null
  pointerId: number
  d: string
}

type Ghost = { id: number; path: string; kind: 'retract' | 'settle' }

/** Curva cúbica que sai do contorno pela normal e chega (encaixada) pela normal do alvo. */
function curve(o: BoundaryHit, e: { x: number; y: number }, en: { nx: number; ny: number } | null) {
  const dist = Math.hypot(e.x - o.x, e.y - o.y)
  const k = Math.min(Math.max(dist * 0.4, 24), 140)
  const c1 = { x: o.x + o.nx * k, y: o.y + o.ny * k }
  const ux = (o.x - e.x) / (dist || 1)
  const uy = (o.y - e.y) / (dist || 1)
  const c2 = en ? { x: e.x + en.nx * k, y: e.y + en.ny * k } : { x: e.x + ux * k * 0.5, y: e.y + uy * k * 0.5 }
  return `M ${o.x} ${o.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`
}

/**
 * Conexão pelo contorno dos cards. Sem handles fixos: o ponteiro é projetado no perímetro (cantos arredondados incluídos)
 * dentro de uma faixa magnética de largura constante na tela; o indicador acompanha o contorno e o arraste começa
 * exatamente nesse ponto. O alvo também ganha indicador no perímetro e encaixe visual. Tudo é feito com refs e
 * requestAnimationFrame, sem estado React por movimento do mouse.
 */
export function BoundaryConnect({ contents, relations, positions, presentIds, selectedId, onConnect, onNotify, onBusy }: Props) {
  const api = useStoreApi()
  const layerRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLDivElement>(null)
  const tgtRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const glowRef = useRef<SVGPathElement>(null)
  const coreRef = useRef<SVGPathElement>(null)
  const flowRef = useRef<SVGPathElement>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)

  const dataRef = useRef({ contents, relations, positions, presentIds, selectedId, onConnect, onNotify, onBusy })
  useEffect(() => {
    dataRef.current = { contents, relations, positions, presentIds, selectedId, onConnect, onNotify, onBusy }
  })

  useEffect(() => {
    const layer = layerRef.current
    const container = layer?.closest<HTMLElement>('.graph')
    if (!layer || !container) return
    const reduced = prefersReducedMotion()

    let ptr: { x: number; y: number; type: string; buttons: number } | null = null
    let hover: Hit | null = null
    let g: Gesture | null = null
    let raf = 0
    let suppressClickUntil = 0
    let lastTransform = api.getState().transform

    const view = () => {
      const [tx, ty, z] = api.getState().transform
      const r = container.getBoundingClientRect()
      return { tx, ty, z, left: r.left, top: r.top }
    }
    type View = ReturnType<typeof view>
    const toFlow = (cx: number, cy: number, v: View) => ({ x: (cx - v.left - v.tx) / v.z, y: (cy - v.top - v.ty) / v.z })
    const place = (el: HTMLElement | null, p: { x: number; y: number }, v: View) => {
      if (el) el.style.transform = `translate3d(${p.x * v.z + v.tx}px, ${p.y * v.z + v.ty}px, 0)`
    }
    const wrapper = (id: string) => container.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)

    const setAttr = (id: string | null, value: string | null) => {
      if (!id) return
      const el = wrapper(id)
      if (!el) return
      if (value) el.dataset.conn = value
      else delete el.dataset.conn
    }

    /** Nó cujo contorno está mais perto do ponto, dentro da faixa (início) ou do alcance do ímã (alvo). */
    const findHit = (fp: { x: number; y: number }, z: number, mode: 'start' | 'target', exclude?: string): Hit | null => {
      // Zoom muito afastado: o contorno é só parte do card (sem zona de conexão). O alvo de um gesto já iniciado não é afetado.
      if (mode === 'start' && z < CONNECTION_INTERACTION_MIN_ZOOM) return null
      const d = dataRef.current
      let best: Hit | null = null
      for (const c of d.contents) {
        const p = d.positions[c.id]
        if (!p || !d.presentIds.has(c.id) || c.id === exclude) continue
        const s = sizeOf(c.type)
        const hit = getNearestPointOnNodeBoundary({ x: p.x, y: p.y, w: s.w, h: s.h, r: NODE_RADIUS[c.type] }, fp)
        const inner = Math.min(INNER_PX / z, MAX_INNER_FRACTION * Math.min(s.w, s.h))
        const outer = (mode === 'start' ? OUTER_PX : MAGNET_PX) / z
        const ok = mode === 'start' ? hit.distance >= -inner && hit.distance <= outer : hit.distance <= outer
        if (ok && (!best || Math.abs(hit.distance) < Math.abs(best.hit.distance))) best = { id: c.id, hit }
      }
      return best
    }

    let zoneId: string | null = null
    const setHover = (h: Hit | null, v?: View) => {
      hover = h
      const ind = indRef.current
      if (!ind || g) return
      // Dentro da faixa o card volta à escala 1 (sem hover/proximidade): o indicador fica exatamente sobre o contorno visível.
      if ((h?.id ?? null) !== zoneId) {
        setAttr(zoneId, null)
        zoneId = h?.id ?? null
        setAttr(zoneId, 'zone')
      }
      if (h && v) {
        place(ind, h.hit, v)
        ind.classList.add('is-on')
      } else {
        ind.classList.remove('is-on')
      }
      container.classList.toggle('is-conn-zone', Boolean(h))
    }

    const evalHover = () => {
      raf = 0
      if (g) return
      if (!ptr || ptr.type === 'touch' || ptr.buttons !== 0) {
        setHover(null)
        return
      }
      const v = view()
      setHover(findHit(toFlow(ptr.x, ptr.y, v), v.z, 'start'), v)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(evalHover)
    }

    const draw = (d: string) => {
      glowRef.current?.setAttribute('d', d)
      coreRef.current?.setAttribute('d', d)
      flowRef.current?.setAttribute('d', d)
    }

    const cleanup = () => {
      cancelAnimationFrame(raf)
      raf = 0
      window.removeEventListener('pointermove', onWinMove)
      window.removeEventListener('pointerup', onWinUp)
      window.removeEventListener('pointercancel', onWinCancel)
      window.removeEventListener('keydown', onKey, true)
      if (g) {
        setAttr(g.from, null)
        setAttr(g.candidateId, null)
      }
      svgRef.current?.classList.remove('is-on', 'is-valid', 'is-invalid')
      indRef.current?.classList.remove('is-on', 'is-origin')
      tgtRef.current?.classList.remove('is-on', 'is-snap', 'is-invalid')
      container.classList.remove('is-connecting', 'is-conn-zone')
      g = null
      hover = null
      setAttr(zoneId, null)
      zoneId = null
      dataRef.current.onBusy(false)
    }

    const finish = (commit: boolean) => {
      if (!g) return
      const { d, from, target, reason } = g
      const done = g
      cleanup()
      suppressClickUntil = performance.now() + 350
      if (commit && target) {
        dataRef.current.onConnect(from, target)
        setGhost({ id: Date.now(), path: d, kind: 'settle' })
      } else {
        if (commit && reason && done.candidateId) dataRef.current.onNotify(reason)
        setGhost({ id: Date.now(), path: d, kind: 'retract' })
      }
    }

    /** Um quadro do arraste: alvo, encaixe, linha e indicadores. */
    const frame = () => {
      if (!g || !ptr) return
      raf = requestAnimationFrame(frame)
      const v = view()
      const fp = toFlow(ptr.x, ptr.y, v)
      const d = dataRef.current
      const cand = findHit(fp, v.z, 'target', g.from)
      const verdict = cand ? inferRelation(d.contents, d.relations, g.from, cand.id) : null
      const valid = Boolean(cand && verdict?.ok)

      if (cand?.id !== g.candidateId) {
        setAttr(g.candidateId, null)
        g.candidateId = cand?.id ?? null
      }
      g.reason = verdict && !verdict.ok ? verdict.reason : null
      g.target = valid && cand ? cand.id : null
      if (cand) setAttr(cand.id, valid ? 'valid' : 'invalid')

      // Encaixe magnético: a ponta da linha desliza até o contorno do alvo; fora dele, segue o cursor sem atraso.
      const goal = valid && cand ? { x: cand.hit.x, y: cand.hit.y } : fp
      const k = reduced ? 1 : valid ? 0.4 : g.snapped ? 0.5 : 1
      g.end.x += (goal.x - g.end.x) * k
      g.end.y += (goal.y - g.end.y) * k
      g.snapped = valid
      g.endNormal = valid && cand ? { nx: cand.hit.nx, ny: cand.hit.ny } : null
      g.d = curve(g.origin, g.end, g.endNormal)
      draw(g.d)

      const svg = svgRef.current
      svg?.classList.toggle('is-valid', valid)
      svg?.classList.toggle('is-invalid', Boolean(cand) && !valid)

      const tgt = tgtRef.current
      if (tgt) {
        if (cand) {
          place(tgt, cand.hit, v)
          tgt.classList.add('is-on')
        } else {
          tgt.classList.remove('is-on')
        }
        tgt.classList.toggle('is-snap', valid)
        tgt.classList.toggle('is-invalid', Boolean(cand) && !valid)
      }
    }

    function onWinMove(e: PointerEvent) {
      if (g && e.pointerId === g.pointerId) ptr = { x: e.clientX, y: e.clientY, type: e.pointerType, buttons: e.buttons }
    }
    function onWinUp(e: PointerEvent) {
      if (g && e.pointerId === g.pointerId) {
        ptr = { x: e.clientX, y: e.clientY, type: e.pointerType, buttons: 0 }
        frame()
        cancelAnimationFrame(raf)
        finish(true)
      }
    }
    function onWinCancel() {
      finish(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        finish(false)
      }
    }

    const begin = (h: Hit, e: PointerEvent) => {
      const v = view()
      g = {
        from: h.id,
        origin: h.hit,
        end: { x: h.hit.x, y: h.hit.y },
        endNormal: null,
        snapped: false,
        target: null,
        candidateId: null,
        reason: null,
        pointerId: e.pointerId,
        d: curve(h.hit, h.hit, null),
      }
      ptr = { x: e.clientX, y: e.clientY, type: e.pointerType, buttons: 1 }
      container.classList.remove('is-conn-zone')
      container.classList.add('is-connecting')
      // O indicador fica congelado no ponto escolhido: a linha nasce exatamente dali.
      place(indRef.current, h.hit, v)
      indRef.current?.classList.add('is-on', 'is-origin')
      zoneId = null
      setAttr(h.id, 'source')
      svgRef.current?.classList.add('is-on')
      draw(g.d)
      dataRef.current.onBusy(true)
      window.addEventListener('pointermove', onWinMove)
      window.addEventListener('pointerup', onWinUp)
      window.addEventListener('pointercancel', onWinCancel)
      window.addEventListener('keydown', onKey, true)
      raf = requestAnimationFrame(frame)
    }

    const onDown = (e: PointerEvent) => {
      if (!container.contains(e.target as Node)) return
      // Shift é o gesto de seleção por área: não inicia conexão.
      if (g || e.button !== 0 || !e.isPrimary || e.shiftKey) return
      // Sobre uma conexão, o clique seleciona a conexão (não inicia outra).
      if ((e.target as Element).closest('.react-flow__panel, .edge-menu, .edge-label, .react-flow__edge, button, a, input, textarea')) return
      const v = view()
      let h = findHit(toFlow(e.clientX, e.clientY, v), v.z, 'start')
      // Em toque não há hover: só o card selecionado pode iniciar uma conexão pelo contorno.
      if (h && e.pointerType === 'touch' && h.id !== dataRef.current.selectedId) h = null
      if (!h) return
      e.preventDefault()
      e.stopPropagation()
      begin(h, e)
    }
    const onMove = (e: PointerEvent) => {
      if (g) return
      const overUi = (e.target as Element).closest('.react-flow__panel, .edge-menu, .react-flow__edge')
      ptr = overUi || e.shiftKey ? null : { x: e.clientX, y: e.clientY, type: e.pointerType, buttons: e.buttons }
      schedule()
    }
    const onLeave = () => {
      if (g) return
      ptr = null
      schedule()
    }
    const stopWhileConnecting = (e: Event) => {
      if (g) e.stopPropagation()
    }
    const stopClick = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    // Zoom/pan mudam a posição do ponto na tela: esconde o indicador até o próximo movimento.
    const unsubscribe = api.subscribe((state) => {
      if (state.transform !== lastTransform) {
        lastTransform = state.transform
        if (!g && hover) setHover(null)
      }
      // Ao cruzar o limite sem gesto em andamento, o indicador some (fade) e o cursor volta ao normal.
      if (!g && state.transform[2] < CONNECTION_INTERACTION_MIN_ZOOM) {
        indRef.current?.classList.remove('is-on')
        container.classList.remove('is-conn-zone')
      }
    })

    // Na janela (captura): precisa rodar antes dos handlers de captura do React Flow, que iniciariam a seleção por área.
    window.addEventListener('pointerdown', onDown, true)
    container.addEventListener('mousedown', stopWhileConnecting, true)
    container.addEventListener('touchstart', stopWhileConnecting, true)
    container.addEventListener('click', stopClick, true)
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerleave', onLeave)
    return () => {
      unsubscribe()
      window.removeEventListener('pointerdown', onDown, true)
      container.removeEventListener('mousedown', stopWhileConnecting, true)
      container.removeEventListener('touchstart', stopWhileConnecting, true)
      container.removeEventListener('click', stopClick, true)
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerleave', onLeave)
      if (g) cleanup()
      cancelAnimationFrame(raf)
    }
  }, [api])

  return (
    <>
      <div className="conn-overlay" ref={layerRef} aria-hidden="true">
        <div className="conn-ind" ref={indRef}>
          <i />
        </div>
        <div className="conn-ind conn-ind-target" ref={tgtRef}>
          <i />
          <span>Soltar para conectar</span>
        </div>
      </div>
      <ViewportPortal>
        <svg className="conn-gesture conn-line" ref={svgRef} width={1} height={1} aria-hidden="true">
          <path ref={glowRef} className="conn-glow" fill="none" />
          <path ref={coreRef} className="conn-core" fill="none" />
          <path ref={flowRef} className="conn-flow" fill="none" />
        </svg>
        {ghost && (
          <svg key={ghost.id} className={`conn-ghost ghost-${ghost.kind}`} width={1} height={1} aria-hidden="true">
            <path d={ghost.path} pathLength={1} className="conn-ghost-path" fill="none" onAnimationEnd={() => setGhost(null)} />
          </svg>
        )}
      </ViewportPortal>
    </>
  )
}
