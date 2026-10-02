import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Background, Panel, ReactFlow, SelectionMode, ViewportPortal, useReactFlow, useStoreApi } from '@xyflow/react'
import type { FitViewOptions, NodeChange } from '@xyflow/react'
import { Info, Maximize, Wand2, ZoomIn, ZoomOut } from 'lucide-react'
import type { Content, Position, Positions, Relation } from '../types'
import { sizeOf } from '../lib/dimensions'
import { COLLECTIONS } from '../lib/mock'
import { MOTION, motionDuration, prefersReducedMotion } from '../lib/motion'
import { RELATION_RULES } from '../lib/relations'
import { clusterAssignments } from '../lib/spatial'
import type { MatchInfo } from '../lib/search'
import { levelForZoom, nextLevel } from '../lib/zoom'
import { BoundaryConnect } from './BoundaryConnect'
import { ContentNode } from './ContentNode'
import type { ContentFlowNode, DetailLevel, Emphasis, QueryState } from './ContentNode'
import { IconButton } from './IconButton'
import { RelationEdge } from './RelationEdge'
import type { RelationFlowEdge } from './RelationEdge'
import { BRAND_CYAN, TYPE_META, hexToRgba } from './meta'

const nodeTypes = { content: ContentNode }
const edgeTypes = { relation: RelationEdge }

/** Margens do enquadramento: mais espaço embaixo, onde fica a barra de controles. */
export const FIT_OPTIONS: FitViewOptions = {
  padding: { top: '36px', right: '36px', bottom: '104px', left: '36px' },
  minZoom: 0.1,
  maxZoom: 1,
}

const HALO_PAD = 70
const HOVER_ENTER_DELAY = 30
/** Raio (px de tela) em que o mouse começa a influenciar os nós. */
const PROXIMITY_RADIUS = 300

interface Props {
  /** Todos os conteúdos: os que não correspondem à busca continuam montados e apenas saem de cena (CSS). */
  contents: Content[]
  relations: Relation[]
  positions: Positions
  /** IDs presentes (passam pelos filtros de tipo/tema/status). Os demais saem de cena com fade. */
  presentIds: Set<string>
  /** IDs que também correspondem à pesquisa de texto (resultado lógico). Quando não há texto, igual a presentIds. */
  matchedIds: Set<string>
  /** Há pesquisa de texto: quem não corresponde fica visível, porém esmaecido. */
  queryActive: boolean
  matchInfo: Map<string, MatchInfo>
  resultMode: boolean
  /** Resultado destacado pela lista opcional (hover). */
  previewId: string | null
  /** Conexão e nó recém-criados (animação de chegada). */
  freshEdgeId: string | null
  pulseId: string | null
  /** Conteúdo recém-criado: entra com uma animação curta. */
  bornIds: Set<string>
  selectedId: string | null
  /** Seleção múltipla (2 ou mais). Com 1 só, vale `selectedId`. */
  groupIds: string[]
  /** Nós com aparência de selecionados sem alterar a seleção (alvo do menu de contexto, cópias recém-criadas). */
  highlightIds: Set<string>
  /** Nova seleção (qualquer tamanho), vinda de cliques, Shift+clique, retângulo ou teclado. */
  onSelectionChange: (ids: string[]) => void
  onPaneMenu: (clientX: number, clientY: number) => void
  onNodeMenu: (clientX: number, clientY: number, nodeId: string) => void
  /** Cria a conexão entre dois conteúdos (tipo e direção são inferidos). */
  onConnect: (aId: string, bId: string) => void
  /** Mensagem curta (por exemplo, conexão inválida ou duplicada). */
  onNotify: (message: string) => void
  onRemoveRelation: (id: string) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, position: Position) => void
  /** Chamado ao soltar um nó arrastado: a posição passa a ser "manual" (peso de fixação maior no layout). */
  onPin: (id: string) => void
  /** `true` quando o clique veio com Shift (reorganizar do zero). */
  onRelayout: (fromScratch: boolean) => void
}

/** Nível de detalhe do zoom com histerese; só renderiza de novo quando o nível muda. */
function useDetailLevel(): DetailLevel {
  const api = useStoreApi()
  const [level, setLevel] = useState<DetailLevel>(() => levelForZoom(api.getState().transform[2]))
  useEffect(() => {
    let current = levelForZoom(api.getState().transform[2])
    return api.subscribe((state) => {
      const next = nextLevel(current, state.transform[2])
      if (next !== current) {
        current = next
        setLevel(next)
      }
    })
  }, [api])
  return level
}

/**
 * Reação progressiva à proximidade do mouse: escreve `--prox` (0 a 1) direto no DOM dos nós, sem
 * re-renderizar o React nem mexer no layout. O CSS transforma o valor em escala e brilho.
 */
function useProximity(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    let point: { x: number; y: number } | null = null
    let frame = 0
    let applied = false

    const apply = () => {
      frame = 0
      // Sem ponteiro livre (arrasto/seleção) e nada aplicado: não toca no DOM.
      if (!point && !applied) return
      applied = point !== null
      el.querySelectorAll<HTMLElement>('.react-flow__node .node').forEach((node) => {
        if (!point || node.classList.contains('presence-out')) {
          node.style.removeProperty('--prox')
          return
        }
        const r = node.getBoundingClientRect()
        const dx = Math.max(r.left - point.x, 0, point.x - r.right)
        const dy = Math.max(r.top - point.y, 0, point.y - r.bottom)
        const t = Math.max(0, 1 - Math.hypot(dx, dy) / PROXIMITY_RADIUS)
        node.style.setProperty('--prox', (t * t).toFixed(3))
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onMove = (e: PointerEvent) => {
      // Só mouse sem botão pressionado: em touch não há hover e durante o arraste o efeito atrapalha.
      const connecting = el.classList.contains('is-connecting')
      point = e.pointerType === 'mouse' && (e.buttons === 0 || connecting) ? { x: e.clientX, y: e.clientY } : null
      schedule()
    }
    const onLeave = () => {
      point = null
      schedule()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(frame)
    }
  }, [ref])
}

/** Distância entre o topo do conjunto e a base do título (unidades do mapa). */
const TITLE_GAP = 56

/**
 * Halo e título de cada conjunto, derivados da geometria ATUAL dos nós do próprio conjunto (caixa delimitadora de todos os
 * membros, inclusive os que a busca esmaeceu, para não oscilar). O título fica acima do conjunto, alinhado à esquerda da caixa.
 * Como a caixa vem das posições, que a animação de layout atualiza a cada quadro, o título acompanha o grupo sem atraso
 * e sem teleporte. É só apresentação: não entra nas colisões do layout.
 */
function ClusterHalos({
  contents,
  relations,
  positions,
  matchedIds,
}: {
  contents: Content[]
  relations: Relation[]
  positions: Positions
  matchedIds: Set<string>
}) {
  const clusters = useMemo(() => clusterAssignments(contents, relations), [contents, relations])
  const halos = useMemo(() => {
    return COLLECTIONS.flatMap((collection) => {
      const members = contents.filter((c) => clusters.get(c.id) === collection.id && positions[c.id])
      if (members.length === 0) return []
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const m of members) {
        const p = positions[m.id]
        const s = sizeOf(m.type)
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x + s.w)
        maxY = Math.max(maxY, p.y + s.h)
      }
      return [
        {
          collection,
          active: members.some((m) => matchedIds.has(m.id)),
          x: minX - HALO_PAD,
          y: minY - HALO_PAD,
          w: maxX - minX + HALO_PAD * 2,
          h: maxY - minY + HALO_PAD * 2,
          titleX: minX,
          titleY: minY - TITLE_GAP,
          titleMax: maxX - minX,
        },
      ]
    })
  }, [contents, clusters, positions, matchedIds])

  return (
    <ViewportPortal>
      {halos.map(({ collection, active, x, y, w, h, titleX, titleY, titleMax }) => (
        <div key={collection.id} className={`cluster ${active ? '' : 'cluster-out'}`}>
          <div
            className="halo"
            style={{
              transform: `translate(${x}px, ${y}px)`,
              width: w,
              height: h,
              background: `radial-gradient(closest-side, ${hexToRgba(collection.color, 0.07)}, ${hexToRgba(collection.color, 0)})`,
            }}
          />
          <span
            className="cluster-title"
            style={{ transform: `translate(${titleX}px, ${titleY}px) translateY(-100%)`, maxWidth: Math.max(titleMax, 360), color: hexToRgba(collection.color, 0.85) }}
          >
            {collection.name}
          </span>
        </div>
      ))}
    </ViewportPortal>
  )
}

function Legend() {
  return (
    <div className="legend-body" role="region" aria-label="Legenda">
      <p className="legend-title">Conjuntos</p>
      <ul>
        {COLLECTIONS.map((c) => (
          <li key={c.id}>
            <span className="legend-swatch" style={{ background: c.color }} aria-hidden="true" />
            {c.name}
          </li>
        ))}
      </ul>
      <p className="legend-title">Relações (a seta indica o sentido)</p>
      <ul>
        {Object.values(RELATION_RULES).map((rule) => (
          <li key={rule.edgeLabel}>
            {TYPE_META[rule.source].label} <span className="legend-arrow">{rule.edgeLabel}</span> {TYPE_META[rule.target].label}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function GraphView({
  contents,
  relations,
  positions,
  presentIds,
  matchedIds,
  queryActive,
  matchInfo,
  resultMode,
  previewId,
  freshEdgeId,
  pulseId,
  bornIds,
  selectedId,
  groupIds,
  highlightIds,
  onSelectionChange,
  onPaneMenu,
  onNodeMenu,
  onConnect,
  onNotify,
  onRemoveRelation,
  onSelect,
  onMove,
  onPin,
  onRelayout,
}: Props) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const level = useDetailLevel()
  const [hoveredRaw, setHoveredId] = useState<string | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const connecting = useRef(false)
  const hoverTimer = useRef<number | undefined>(undefined)
  const dragging = useRef(false)
  const graphRef = useRef<HTMLDivElement>(null)
  useProximity(graphRef)

  // Hover só vale para nós presentes: se o nó sair dos resultados, o destaque some sozinho.
  const hoverCandidate = previewId ?? hoveredRaw
  const hoveredId = hoverCandidate && presentIds.has(hoverCandidate) ? hoverCandidate : null

  const scheduleHover = useCallback((id: string | null) => {
    window.clearTimeout(hoverTimer.current)
    if (connecting.current) return
    // Entrar é quase imediato; sair espera um instante para não piscar ao atravessar vizinhos.
    hoverTimer.current = window.setTimeout(() => setHoveredId(id), id ? HOVER_ENTER_DELAY : MOTION.hoverLeaveDelay)
  }, [])

  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  const focusId = hoveredId ?? (selectedId && presentIds.has(selectedId) ? selectedId : null)

  const neighbors = useMemo(() => {
    const set = new Set<string>()
    if (!focusId) return set
    for (const r of relations) {
      if (r.source === focusId) set.add(r.target)
      if (r.target === focusId) set.add(r.source)
    }
    return set
  }, [relations, focusId])

  const queryStateOf = useCallback(
    (id: string): QueryState => {
      if (!queryActive) return 'off'
      if (!matchedIds.has(id)) return 'miss'
      return (matchInfo.get(id)?.titleRanges.length ?? 0) > 0 ? 'primary' : 'secondary'
    },
    [queryActive, matchedIds, matchInfo],
  )

  const groupSet = useMemo(() => new Set(groupIds), [groupIds])

  // Cada nó só ganha um objeto novo quando algo que o afeta mudou. Com identidade estável, o React Flow não readota o nó,
  // o card (memo) não renderiza de novo e as arestas dele não recalculam: numa seleção por área, só mudam os nós que entram/saem.
  const [nodeCache] = useState(() => new Map<string, { sig: readonly unknown[]; node: ContentFlowNode }>())

  const nodes = useMemo<ContentFlowNode[]>(
    () =>
      contents.map((content) => {
        const size = sizeOf(content.type)
        const pos = positions[content.id]
        const present = presentIds.has(content.id)
        const queryState = present ? queryStateOf(content.id) : 'off'
        let emphasis: Emphasis = 'none'
        if (present && focusId && content.id !== focusId) emphasis = neighbors.has(content.id) ? 'related' : 'dim'
        const realSel = present && (content.id === selectedId || groupSet.has(content.id))
        const selected = realSel || (present && highlightIds.has(content.id))
        const hovered = present && content.id === hoveredId
        const zIndex = hovered || selected ? 5 : emphasis === 'related' ? 2 : 0
        const pulse = content.id === pulseId
        const born = bornIds.has(content.id)
        const search = present && queryState !== 'miss' ? (matchInfo.get(content.id) ?? null) : null
        const nodeResultMode = resultMode && present && queryState !== 'miss'

        const sig = [content, pos?.x, pos?.y, level, realSel, selected, hovered, emphasis, present, queryState, pulse, born, search, nodeResultMode, zIndex]
        const prev = nodeCache.get(content.id)
        if (prev && prev.sig.every((v, k) => v === sig[k])) return prev.node

        const node: ContentFlowNode = {
          id: content.id,
          type: 'content',
          position: pos ?? { x: 0, y: 0 },
          width: size.w,
          height: size.h,
          // Caixa fixa por tipo: informar também como medida evita o aviso de arraste em nó "não inicializado".
          measured: { width: size.w, height: size.h },
          zIndex,
          selected: realSel,
          // Nós em saída não recebem clique, foco, seleção nem arraste.
          className: present ? undefined : 'is-out',
          focusable: present,
          selectable: present,
          draggable: present,
          connectable: present,
          ariaLabel: `${TYPE_META[content.type].label}: ${content.title}`,
          data: {
            content,
            level,
            selected,
            hovered,
            emphasis,
            presence: present ? 'in' : 'out',
            queryState,
            pulse,
            born,
            search,
            resultMode: nodeResultMode,
          },
        }
        nodeCache.set(content.id, { sig, node })
        return node
      }),
    [contents, positions, presentIds, queryStateOf, matchInfo, resultMode, selectedId, hoveredId, focusId, neighbors, level, pulseId, bornIds, groupSet, highlightIds, nodeCache],
  )

  const titleOf = useMemo(() => new Map(contents.map((c) => [c.id, c.title])), [contents])

  const edges = useMemo<RelationFlowEdge[]>(
    () =>
      relations.map((r) => {
        const present = presentIds.has(r.source) && presentIds.has(r.target)
        const highlighted = present && focusId !== null && (r.source === focusId || r.target === focusId)
        const secondary =
          present && focusId !== null && !highlighted && (neighbors.has(r.source) || neighbors.has(r.target))
        const queryMatch = queryActive && matchedIds.has(r.source) && matchedIds.has(r.target)
        const color = BRAND_CYAN
        return {
          id: r.id,
          type: 'relation',
          source: r.source,
          target: r.target,
          className: present ? undefined : 'is-out',
          focusable: false,
          data: {
            label: RELATION_RULES[r.type].edgeLabel,
            title: `${titleOf.get(r.source) ?? '?'} ${RELATION_RULES[r.type].edgeLabel} ${titleOf.get(r.target) ?? '?'}`,
            highlighted,
            secondary,
            dimmed: present && ((focusId !== null && !highlighted && !secondary) || (queryActive && !queryMatch && focusId === null)),
            queryMatch,
            fresh: r.id === freshEdgeId,
            selected: r.id === selectedEdgeId,
            onRemove: (id: string) => {
              setSelectedEdgeId(null)
              onRemoveRelation(id)
            },
            color,
          },
        }
      }),
    [relations, presentIds, matchedIds, queryActive, focusId, neighbors, freshEdgeId, selectedEdgeId, titleOf, onRemoveRelation],
  )

  /** Uma conexão pelo contorno começou/terminou: suspende o hover (a conexão tem seus próprios destaques). */
  const handleBusy = useCallback((busy: boolean) => {
    connecting.current = busy
    if (busy) {
      window.clearTimeout(hoverTimer.current)
      setHoveredId(null)
      setSelectedEdgeId(null)
    }
  }, [])

  // Seleção por área (Shift + arrastar ou modo armado): Escape cancela e restaura a seleção anterior.
  const selecting = useRef(false)
  const cancelled = useRef(false)
  const snapshot = useRef<string[]>([])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selecting.current) {
        cancelled.current = true
        graphRef.current?.classList.add('sel-cancelled')
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // O botão do meio é só do pan: impede o autoscroll nativo do navegador (sem interromper a propagação para o pan).
  useEffect(() => {
    const el = graphRef.current
    if (!el) return
    const block = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    el.addEventListener('mousedown', block, true)
    el.addEventListener('auxclick', block, true)
    return () => {
      el.removeEventListener('mousedown', block, true)
      el.removeEventListener('auxclick', block, true)
    }
  }, [])

  // Seleção: os eventos do React Flow chegam a cada movimento do mouse; aplicamos num conjunto (Set) em memória e
  // publicamos no máximo UMA vez por quadro, e só se o conjunto realmente mudou.
  const currentSel = useRef<Set<string>>(new Set())
  const pendingSel = useRef<Set<string> | null>(null)
  const selFrame = useRef(0)
  useEffect(() => {
    currentSel.current = new Set([...(selectedId ? [selectedId] : []), ...groupIds])
  }, [selectedId, groupIds])
  useEffect(() => () => cancelAnimationFrame(selFrame.current), [])

  const flushSelection = useCallback(() => {
    selFrame.current = 0
    const next = pendingSel.current
    pendingSel.current = null
    if (!next || cancelled.current) return
    const prev = currentSel.current
    if (next.size === prev.size && [...next].every((id) => prev.has(id))) return
    currentSel.current = next
    onSelectionChange([...next])
  }, [onSelectionChange])

  const handleNodesChange = useCallback(
    (changes: NodeChange<ContentFlowNode>[]) => {
      let base: Set<string> | null = null
      for (const change of changes) {
        if (change.type === 'position' && change.position) onMove(change.id, change.position)
        if (change.type === 'select' && presentIds.has(change.id)) {
          base ??= new Set(pendingSel.current ?? currentSel.current)
          if (change.selected) base.add(change.id)
          else base.delete(change.id)
        }
      }
      if (base) {
        pendingSel.current = base
        if (!selFrame.current) selFrame.current = requestAnimationFrame(flushSelection)
      }
    },
    [onMove, presentIds, flushSelection],
  )

  return (
    <div className="graph" data-level={level} ref={graphRef}>
      <ReactFlow<ContentFlowNode, RelationFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={(event, node) => {
          setSelectedEdgeId(null)
          // Com Shift/Ctrl/Cmd o clique alterna na seleção múltipla (tratado pelo React Flow); sem modificador, seleção única.
          if (event.shiftKey || event.ctrlKey || event.metaKey) return
          if (presentIds.has(node.id)) onSelect(node.id)
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setSelectedEdgeId(null)
          onPaneMenu(e.clientX, e.clientY)
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          if (presentIds.has(node.id)) onNodeMenu(e.clientX, e.clientY, node.id)
        }}
        onSelectionContextMenu={(e, picked) => {
          e.preventDefault()
          if (picked[0]) onNodeMenu(e.clientX, e.clientY, picked[0].id)
        }}
        onEdgeContextMenu={(e) => e.preventDefault()}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        // Convenção do mouse: esquerdo no vazio = seleção por área; botão do meio = pan; roda = zoom; direito = menu.
        selectionOnDrag
        panOnDrag={[1]}
        zoomOnScroll
        zoomOnDoubleClick={false}
        onSelectionStart={() => {
          selecting.current = true
          graphRef.current?.classList.add('is-selecting')
          cancelled.current = false
          snapshot.current = [...(selectedId ? [selectedId] : []), ...groupIds]
        }}
        onSelectionEnd={() => {
          selecting.current = false
          if (cancelled.current) {
            cancelled.current = false
            onSelectionChange(snapshot.current)
          }
          graphRef.current?.classList.remove('sel-cancelled', 'is-selecting')
        }}
        onSelectionDragStop={(_, picked) => picked.forEach((n) => onPin(n.id))}
        onPaneClick={() => {
          setSelectedEdgeId(null)
          onSelect(null)
        }}
        onEdgeClick={(event, edge) => {
          event.stopPropagation()
          setSelectedEdgeId((current) => (current === edge.id ? null : edge.id))
        }}
        nodesConnectable={false}
        onNodeMouseEnter={(_, node) => !dragging.current && scheduleHover(node.id)}
        onNodeMouseLeave={() => scheduleHover(null)}
        onNodeDragStart={() => {
          dragging.current = true
          window.clearTimeout(hoverTimer.current)
        }}
        onNodeDragStop={(_, node, dragged) => {
          dragging.current = false
          // Movimento coletivo: todos os nós arrastados passam a contar como posicionados à mão.
          for (const n of dragged?.length ? dragged : [node]) onPin(n.id)
        }}
        nodeDragThreshold={3}
        selectNodesOnDrag={false}
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.1}
        maxZoom={1.6}
        edgesFocusable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        aria-label="Grafo de conteúdos"
      >
        <Background gap={32} size={1} color="rgba(140, 165, 220, 0.07)" />
        <ClusterHalos contents={contents} relations={relations} positions={positions} matchedIds={presentIds} />
        <BoundaryConnect
          contents={contents}
          relations={relations}
          positions={positions}
          presentIds={presentIds}
          selectedId={selectedId}
          onConnect={onConnect}
          onNotify={onNotify}
          onBusy={handleBusy}
        />
        <Panel position="bottom-center" className="dock-panel">
          {legendOpen && <Legend />}
          <div className="dock" role="toolbar" aria-label="Controles do grafo">
            <IconButton label="Afastar" tipSide="top" onClick={() => zoomOut({ duration: motionDuration(MOTION.hover + 40) })}>
              <ZoomOut size={17} aria-hidden="true" />
            </IconButton>
            <IconButton label="Aproximar" tipSide="top" onClick={() => zoomIn({ duration: motionDuration(MOTION.hover + 40) })}>
              <ZoomIn size={17} aria-hidden="true" />
            </IconButton>
            <IconButton label="Ajustar à tela" tipSide="top" onClick={() => fitView({ ...FIT_OPTIONS, duration: motionDuration(MOTION.camera) })}>
              <Maximize size={17} aria-hidden="true" />
            </IconButton>
            <span className="dock-sep" aria-hidden="true" />
            <IconButton label="Reorganizar" tipSide="top" onClick={(e) => onRelayout(e.shiftKey)}>
              <Wand2 size={17} aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Legenda"
              tipSide="top"
              aria-pressed={legendOpen}
              className={legendOpen ? 'is-on' : ''}
              onClick={() => setLegendOpen((v) => !v)}
            >
              <Info size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
