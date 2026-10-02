import { memo, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react'
import type { Edge, EdgeProps, InternalNode } from '@xyflow/react'
import { Unlink } from 'lucide-react'
import { exitT, pathOf, pointAt, quad, tangentAt } from '../lib/edgeGeometry'
import type { Rect } from '../lib/edgeGeometry'

export type RelationEdgeData = {
  label: string
  /** Descrição curta para o menu: "Origem → Destino". */
  title: string
  /** Aresta ligada ao nó em foco (hover ou seleção). */
  highlighted: boolean
  /** Aresta de segundo nível (liga um vizinho do foco): presença intermediária. */
  secondary: boolean
  dimmed: boolean
  /** Aresta ligada a resultados da busca. */
  queryMatch: boolean
  /** Conexão recém-criada: traçado desenhado com animação. */
  fresh: boolean
  /** Conexão selecionada: mostra o menu de remoção. */
  selected: boolean
  onRemove: (id: string) => void
  color: string
} & Record<string, unknown>

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

const ARROW_GAP = 5
const ARROW_LEN = 11
const ARROW_HALF = 5.5

function rectOf(node: InternalNode): Rect {
  const w = node.width ?? node.measured.width ?? 0
  const h = node.height ?? node.measured.height ?? 0
  const { x, y } = node.internals.positionAbsolute
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 }
}

/** Menu contextual da conexão selecionada, com confirmação leve (sem modal). Monta ao selecionar, então a confirmação sempre começa fechada. */
function EdgeMenu({ title, onRemove }: { title: string; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <span className="edge-menu-title">{title}</span>
      {confirming ? (
        <span className="edge-menu-actions">
          <button type="button" className="edge-menu-btn is-danger" onClick={onRemove}>
            Confirmar remoção
          </button>
          <button type="button" className="edge-menu-btn" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button type="button" className="edge-menu-btn" onClick={() => setConfirming(true)}>
          <Unlink size={13} aria-hidden="true" />
          Remover conexão
        </button>
      )}
    </>
  )
}

/**
 * Aresta "por trás" dos cards. A relação é traçada de centro a centro (ponto lógico no centro do card) e fica abaixo
 * dos nós, que são opacos: a linha parece emergir de trás de cada card. Só a ponta da seta, o rótulo e o menu usam o
 * ponto onde a curva cruza a borda do card, para nunca invadirem a área legível.
 */
function RelationEdgeView({ id, source, target, data }: EdgeProps<RelationFlowEdge>) {
  const [hover, setHover] = useState(false)
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const ra = rectOf(sourceNode)
  const rb = rectOf(targetNode)
  const q = quad({ x: ra.cx, y: ra.cy }, { x: rb.cx, y: rb.cy })
  const path = pathOf(q)

  // Trecho visível: entre a saída do card de origem e a entrada no card de destino.
  const tStart = exitT(q, ra, false, 0)
  const tEnd = exitT(q, rb, true, ARROW_GAP)
  const hasGap = tEnd > tStart + 0.02
  const tMid = hasGap ? (tStart + tEnd) / 2 : 0.5
  const mid = pointAt(q, tMid)

  const tip = pointAt(q, tEnd)
  const dir = tangentAt(q, tEnd)
  const arrow = `M ${tip.x} ${tip.y} L ${tip.x - dir.x * ARROW_LEN - dir.y * ARROW_HALF} ${tip.y - dir.y * ARROW_LEN + dir.x * ARROW_HALF} L ${tip.x - dir.x * ARROW_LEN + dir.y * ARROW_HALF} ${tip.y - dir.y * ARROW_LEN - dir.x * ARROW_HALF} Z`

  const active = Boolean(data?.highlighted)
  const selected = Boolean(data?.selected)
  const fresh = Boolean(data?.fresh)
  const classes = ['relation-edge']
  if (active) classes.push('edge-active')
  else if (data?.secondary) classes.push('edge-secondary')
  else if (data?.dimmed) classes.push('edge-dim')
  if (data?.queryMatch) classes.push('edge-query')
  if (fresh) classes.push('edge-fresh')
  if (selected) classes.push('edge-selected')
  if (hover) classes.push('edge-hover')
  const gradientId = `edge-grad-${id}`

  return (
    <g
      className={classes.join(' ')}
      style={{ '--edge-color': data?.color } as React.CSSProperties}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {(active || selected) && (
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y}>
            <stop offset="0" stopColor="#009adc" />
            <stop offset="1" stopColor="#7be3ff" />
          </linearGradient>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        pathLength={1}
        style={active || selected ? { stroke: `url(#${gradientId})` } : undefined}
      />
      {hasGap && <path d={arrow} className="edge-arrow" />}
      {/* Partícula no sentido da relação, só no contexto ativo; vem de trás do card de origem. */}
      {active && <circle r={3.2} className="edge-particle" style={{ offsetPath: `path('${path}')` }} />}
      {/* Conexão recém-criada: brilho percorre a linha e a ponta "assenta" com uma expansão luminosa. */}
      {fresh && <circle r={5} className="edge-fresh-glow" style={{ offsetPath: `path('${path}')` }} />}
      {fresh && hasGap && <circle cx={tip.x} cy={tip.y} r={7} className="edge-burst" />}
      {(active || hover) && !selected && data && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {selected && data && (
        <EdgeLabelRenderer>
          <div
            className="edge-menu nodrag nopan"
            role="group"
            aria-label="Conexão selecionada"
            // Portais propagam eventos pelo React: sem isto, o clique no menu alternaria a seleção da aresta.
            onClick={(e) => e.stopPropagation()}
            style={{ transform: `translate(-50%, -100%) translate(${mid.x}px, ${mid.y - 14}px)` }}
          >
            <EdgeMenu title={data.title} onRemove={() => data.onRemove(id)} />
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}


export const RelationEdge = memo(RelationEdgeView)
