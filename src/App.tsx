import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { AlertTriangle, BoxSelect, Copy, Pencil, PanelRightOpen, Plus, Trash2, Wand2, X } from 'lucide-react'
import type { Content, Filters, Positions } from './types'
import { sizeOf } from './lib/dimensions'
import { EMPTY_FILTERS, countActiveFilters, filterContents, hasActiveFilters } from './lib/filters'
import { boundsOf } from './lib/layout'
import { optimizeLocalNeighborhood, organizeGraph } from './lib/spatial'
import { MOTION, easeInOutCubic, motionDuration } from './lib/motion'
import { THEMES } from './lib/mock'
import { useStore } from './state/useStore'
import type { LinkDraft } from './state/useStore'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ContextMenu } from './components/ContextMenu'
import type { MenuItem } from './components/ContextMenu'
import { ContentForm } from './components/ContentForm'
import { ALLOW_MOCK_FALLBACK } from './data/source'
import { CONTENT_TYPES } from './components/meta'
import { DetailPanel } from './components/DetailPanel'
import { ActiveFilters, FilterMenu } from './components/FilterBar'
import { EmptyResults } from './components/EmptyResults'
import { FIT_OPTIONS, GraphView } from './components/GraphView'
import { SearchBox } from './components/SearchBox'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'

type FormState = { mode: 'new'; at?: { x: number; y: number } } | { mode: 'edit'; id: string } | null

type MenuState =
  | { kind: 'pane'; x: number; y: number; flow: { x: number; y: number } }
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'group'; x: number; y: number }
  | null

const DESKTOP_QUERY = '(min-width: 900px)'
/** Largura ocupada pelo painel lateral (largura + margens) em telas largas. */
const PANEL_SPACE = 464
/** Fração da altura ocupada pelo drawer em telas estreitas. */
const DRAWER_FRACTION = 0.62
const EDGE_MARGIN = 28
const DOCK_SPACE = 84

const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches

/** Limite de zoom ao enquadrar resultados: evita ampliar demais um único conteúdo. */
const FRAME_MAX_ZOOM = 0.9

/** Valor com atraso. Quando o campo é esvaziado, a mudança é imediata. */
function useDebouncedQuery(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return value === '' ? '' : debounced
}

function Shell() {
  const store = useStore()
  const { data } = store
  const { setCenter, getZoom, getViewport, setViewport, fitView, fitBounds, flowToScreenPosition, screenToFlowPosition } = useReactFlow()

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const pendingFocus = useRef<string | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const tweenFrame = useRef<number | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [fresh, setFresh] = useState<{ edgeId: string; nodeId: string } | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<Content[] | null>(null)
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set())
  const [bornIds, setBornIds] = useState<Set<string>>(() => new Set())
  const [group, setGroup] = useState<string[]>([])
  const [flash, setFlash] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<MenuState>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  const bornTimer = useRef<number | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)
  const freshTimer = useRef<number | undefined>(undefined)
  const leaveTimer = useRef<number | undefined>(undefined)

  // O campo responde na hora; o cálculo dos resultados usa a consulta com debounce.
  const appliedQuery = useDebouncedQuery(filters.query, MOTION.searchDebounce)
  // Depende só de valores primitivos/listas: digitar não recria os resultados até o debounce fechar.
  const { types, themes: themeFilters, statuses } = filters
  const logicalFilters = useMemo<Filters>(
    () => ({ query: appliedQuery, types, themes: themeFilters, statuses }),
    [appliedQuery, types, themeFilters, statuses],
  )
  const result = useMemo(() => filterContents(data.contents, logicalFilters, THEMES), [data.contents, logicalFilters])
  const visibleContents = result.contents
  // Resultado lógico (filtros + texto): contador, lista, estado vazio e enquadramento.
  const matchedIds = useMemo(() => new Set(visibleContents.map((c) => c.id)), [visibleContents])
  // Presença: só os filtros de tipo/tema/status tiram nós de cena; a pesquisa de texto apenas esmaece quem não corresponde.
  const queryActive = appliedQuery.trim() !== ''
  const filterOnly = useMemo(() => filterContents(data.contents, { ...logicalFilters, query: '' }, THEMES), [data.contents, logicalFilters])
  const visibleIds = useMemo(() => {
    const ids = new Set(filterOnly.contents.map((c) => c.id))
    for (const id of leaving) ids.delete(id)
    return ids
  }, [filterOnly, leaving])

  // Seleção múltipla efetiva: só IDs presentes, e só com 2 ou mais (com 1 vale a seleção única e o painel).
  const effGroup = useMemo(() => {
    const ids = group.filter((id) => visibleIds.has(id))
    return ids.length >= 2 ? ids : []
  }, [group, visibleIds])

  const selected: Content | null = useMemo(
    () =>
      selectedId && effGroup.length === 0 && visibleIds.has(selectedId)
        ? (data.contents.find((c) => c.id === selectedId) ?? null)
        : null,
    [selectedId, effGroup, visibleIds, data.contents],
  )

  // Se a seleção deixou de corresponder, limpa-a: o painel sai com animação e não reabre ao limpar a busca.
  if (selectedId && !visibleIds.has(selectedId)) setSelectedId(null)

  // Mantém o último conteúdo na tela durante a animação de saída do painel.
  const [held, setHeld] = useState<Content | null>(null)
  if (selected && selected !== held) setHeld(selected)
  const closing = !selected && held !== null
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => setHeld(null), motionDuration(MOTION.panel))
    return () => window.clearTimeout(timer)
  }, [closing])
  const panelContent = selected ?? held

  /** Leva um nó à área livre (fora do painel) com zoom confortável e movimento suave. */
  const focusNode = useCallback(
    (id: string) => {
      const content = data.contents.find((c) => c.id === id)
      const p = data.positions[id]
      if (!content || !p) return
      const size = sizeOf(content.type)
      const current = getZoom()
      const zoom = current < 0.8 ? 0.9 : Math.min(current, 1.2)
      const desktop = isDesktop()
      const shiftX = desktop ? PANEL_SPACE / 2 / zoom : 0
      const shiftY = desktop ? 0 : (window.innerHeight * DRAWER_FRACTION) / 2 / zoom
      setCenter(p.x + size.w / 2 + shiftX, p.y + size.h / 2 + shiftY, { zoom, duration: motionDuration(MOTION.camera) })
    },
    [data.contents, data.positions, getZoom, setCenter],
  )

  /** Desloca a câmera apenas o necessário para o nó ficar visível na área livre. Sem fitView, sem mudar o zoom. */
  const ensureVisible = useCallback(
    (id: string) => {
      const content = data.contents.find((c) => c.id === id)
      const p = data.positions[id]
      const area = workspaceRef.current?.getBoundingClientRect()
      if (!content || !p || !area) return
      const size = sizeOf(content.type)
      const tl = flowToScreenPosition({ x: p.x, y: p.y })
      const br = flowToScreenPosition({ x: p.x + size.w, y: p.y + size.h })
      const desktop = isDesktop()
      const free = {
        left: area.left + EDGE_MARGIN,
        right: area.right - (desktop ? PANEL_SPACE : EDGE_MARGIN),
        top: area.top + EDGE_MARGIN + 40,
        bottom: area.bottom - (desktop ? DOCK_SPACE : area.height * DRAWER_FRACTION + 8),
      }
      const shift = (lo: number, hi: number, min: number, max: number) => (lo < min ? min - lo : hi > max ? max - hi : 0)
      const dx = shift(tl.x, br.x, free.left, free.right)
      const dy = shift(tl.y, br.y, free.top, free.bottom)
      if (dx === 0 && dy === 0) return
      const vp = getViewport()
      setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: motionDuration(MOTION.camera) })
    },
    [data.contents, data.positions, flowToScreenPosition, getViewport, setViewport],
  )

  // Centraliza um conteúdo recém-criado assim que a posição calculada estiver disponível.
  useEffect(() => {
    const id = pendingFocus.current
    if (id && data.positions[id]) {
      pendingFocus.current = null
      focusNode(id)
    }
  }, [data.positions, focusNode])

  // Escape fecha o painel de detalhes quando não há diálogo aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || form || restoreOpen) return
      if (selectedId) setSelectedId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, form, restoreOpen])

  useEffect(
    () => () => {
      cancelAnimationFrame(tweenFrame.current ?? 0)
      window.clearTimeout(toastTimer.current)
      window.clearTimeout(freshTimer.current)
      window.clearTimeout(leaveTimer.current)
      window.clearTimeout(bornTimer.current)
      window.clearTimeout(flashTimer.current)
    },
    [],
  )

  const notify = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  /** Conexão criada no mapa: persiste pela mesma lista de relações e anima a chegada. */
  const connectNodes = async (aId: string, bId: string) => {
    if (store.live) notify('Gravando conexão na monday…')
    const result = await store.connect(aId, bId)
    if (!result.ok) {
      notify(result.error)
      return
    }
    window.clearTimeout(freshTimer.current)
    setFresh({ edgeId: result.relation.id, nodeId: bId })
    freshTimer.current = window.setTimeout(() => setFresh(null), 1100)
    notify('Conexão criada.')
    // Se o par ficou distante, aproxima só a "folha" (sem mexer nos demais nós), com animação.
    const settled = optimizeLocalNeighborhood(
      { contents: data.contents, relations: [...data.relations, result.relation], positions: data.positions, pinned: new Set(data.pinned) },
      aId,
      bId,
    )
    if (settled) tweenPositions(data.positions, settled)
  }

  // Estável: entra nos dados das arestas, e uma identidade nova a cada renderização invalidaria todas elas.
  const { removeRelation: removeRelationFromStore } = store
  const removeRelation = useCallback(
    async (id: string) => {
      const result = await removeRelationFromStore(id)
      notify(result.ok ? 'Conexão removida. Os conteúdos foram mantidos.' : result.error)
    },
    [removeRelationFromStore, notify],
  )

  /**
   * Exclusão (um ou vários). Com dados da monday, o item é excluído lá primeiro; só os que tiveram sucesso saem de cena
   * (animação) e dos dados. Em caso de erro o nó permanece e o motivo é mostrado.
   */
  const confirmDelete = async () => {
    const targets = deleteTargets
    if (!targets || targets.length === 0) return
    setDeleteTargets(null)
    let ids = targets.map((c) => c.id)
    if (store.live) {
      notify(targets.length === 1 ? 'Excluindo na monday…' : `Excluindo ${targets.length} itens na monday…`)
      const outcome = await store.deleteRemote(ids)
      ids = outcome.deleted
      if (outcome.error) notify(outcome.error)
      if (ids.length === 0) return
    }
    window.clearTimeout(leaveTimer.current)
    if (!store.live || ids.length === targets.length) {
      notify(targets.length === 1 ? `“${targets[0].title}” foi excluído.` : `${targets.length} conteúdos foram excluídos.`)
    }
    const wait = motionDuration(MOTION.exit + 40)
    if (wait === 0) {
      store.deleteContents(ids)
      return
    }
    setLeaving(new Set(ids))
    leaveTimer.current = window.setTimeout(() => {
      store.deleteContents(ids)
      setLeaving(new Set())
    }, wait)
  }

  /** Duplica conteúdos (sem conexões), com animação de entrada e destaque breve das cópias. A câmera não se move. */
  const duplicate = async (ids: string[]) => {
    if (store.live) notify('Duplicando na monday…')
    const outcome = await store.duplicateContents(ids)
    const created = outcome.ids
    if (outcome.error) notify(outcome.error)
    if (created.length === 0) return
    window.clearTimeout(bornTimer.current)
    window.clearTimeout(flashTimer.current)
    setBornIds(new Set(created))
    setFlash(new Set(created))
    bornTimer.current = window.setTimeout(() => setBornIds(new Set()), 1000)
    flashTimer.current = window.setTimeout(() => setFlash(new Set()), 1600)
    if (!outcome.error) notify(created.length === 1 ? 'Conteúdo duplicado (sem conexões).' : `${created.length} conteúdos duplicados (sem conexões).`)
  }

  const applyFilters = (next: Filters) => setFilters(next)
  const clearFilters = () => setFilters(EMPTY_FILTERS)
  const clearSearch = () => {
    setFilters((f) => ({ ...f, query: '' }))
    searchInputRef.current?.focus()
  }
  const clearOtherFilters = () => setFilters((f) => ({ ...f, types: [], themes: [], statuses: [] }))

  /** Enquadra os resultados na área livre, sem ampliar demais. Última intenção de câmera vence. */
  const frameResults = () => {
    const area = workspaceRef.current?.getBoundingClientRect()
    if (!area || visibleContents.length === 0) return
    const b = boundsOf(visibleContents, data.positions)
    const desktop = isDesktop()
    const freeLeft = EDGE_MARGIN
    const freeRight = area.width - (selected && desktop ? PANEL_SPACE : EDGE_MARGIN)
    const freeTop = EDGE_MARGIN + 44
    const freeBottom = area.height - (desktop || !selected ? DOCK_SPACE : area.height * DRAWER_FRACTION + 8)
    const w = Math.max(freeRight - freeLeft, 100)
    const h = Math.max(freeBottom - freeTop, 100)
    const zoom = Math.min(FRAME_MAX_ZOOM, w / (b.width + 80), h / (b.height + 80))
    const z = Math.max(zoom, 0.1)
    const x = freeLeft + (w - b.width * z) / 2 - b.x * z
    const y = freeTop + (h - b.height * z) / 2 - b.y * z
    setViewport({ x, y, zoom: z }, { duration: motionDuration(MOTION.camera) })
  }

  /** Seleção pelo grafo: ajusta a câmera só se o conteúdo ficaria fora da área livre. */
  const selectFromGraph = (id: string | null) => {
    setSelectedId(id)
    setGroup([])
    if (id) ensureVisible(id)
  }

  /** Seleção vinda do grafo (clique, Shift+clique, retângulo, teclado): 0, 1 (painel) ou vários (grupo). */
  const setSelection = useCallback((ids: string[]) => {
    setSelectedId(ids.length === 1 ? ids[0] : null)
    setGroup(ids.length >= 2 ? ids : [])
  }, [])

  const goTo = (id: string) => {
    setSelectedId(id)
    setGroup([])
    focusNode(id)
  }
  const reveal = (id: string) => {
    clearFilters()
    goTo(id)
  }

  /** Ponto do mapa perto do foco do usuário: o conteúdo selecionado ou o centro da área visível. */
  const placementHint = () => {
    if (selected && data.positions[selected.id]) {
      const size = sizeOf(selected.type)
      const p = data.positions[selected.id]
      return { x: p.x + size.w / 2, y: p.y + size.h / 2 }
    }
    const area = workspaceRef.current?.getBoundingClientRect()
    if (!area) return undefined
    const usable = area.width - (isDesktop() ? PANEL_SPACE * 0.5 : 0)
    return screenToFlowPosition({ x: area.left + usable / 2, y: area.top + area.height * 0.45 })
  }

  const handleSave = async (content: Content, links: LinkDraft[]) => {
    const isNew = !data.contents.some((c) => c.id === content.id)
    // Criado pelo menu de contexto: nasce na região clicada (a câmera não se move).
    const at = form?.mode === 'new' ? form.at : undefined
    const result = await store.saveContent(content, links, isNew ? (at ?? placementHint()) : undefined)
    if (result.ok) {
      if (result.warning) notify(result.warning)
      setForm(null)
      if (filterContents([content], filters, THEMES).contents.length === 0) clearFilters()
      setSelectedId(result.id)
      if (isNew) {
        if (!at) pendingFocus.current = result.id
        window.clearTimeout(bornTimer.current)
        setBornIds(new Set([result.id]))
        bornTimer.current = window.setTimeout(() => setBornIds(new Set()), 1000)
      }
    }
    return result
  }

  /**
   * Anima as posições até o novo layout, para que nós e arestas se movam juntos. Só os nós que mudam entram na animação;
   * a duração cresce com a distância (300 a 700 ms) e há um escalonamento sutil a partir do centro da área afetada.
   */
  const tweenPositions = (from: Positions, to: Positions) => {
    cancelAnimationFrame(tweenFrame.current ?? 0)
    const moved = Object.keys(to).filter((id) => from[id] && (from[id].x !== to[id].x || from[id].y !== to[id].y))
    if (moved.length === 0) return
    const maxDist = Math.max(...moved.map((id) => Math.hypot(to[id].x - from[id].x, to[id].y - from[id].y)))
    const ms = motionDuration(Math.min(700, Math.max(300, 300 + maxDist * 0.45)))
    if (ms === 0) {
      store.setPositions(to)
      return
    }
    // Ordem de saída: do nó mais próximo do centro da região afetada ao mais distante (efeito de "onda" discreto).
    const cx = moved.reduce((acc, id) => acc + from[id].x, 0) / moved.length
    const cy = moved.reduce((acc, id) => acc + from[id].y, 0) / moved.length
    const ranked = [...moved].sort((a, b) => Math.hypot(from[a].x - cx, from[a].y - cy) - Math.hypot(from[b].x - cx, from[b].y - cy))
    const maxDelay = moved.length > 1 ? Math.min(120, 16 * moved.length) : 0
    const delays = new Map(ranked.map((id, k) => [id, moved.length > 1 ? (k / (moved.length - 1)) * maxDelay : 0]))
    // O relógio começa no primeiro quadro, para que o cálculo do layout não consuma a duração da animação.
    let start: number | undefined
    const step = (now: number) => {
      start ??= now
      const elapsed = now - start
      const frame: Positions = { ...to }
      let done = true
      for (const id of moved) {
        const t = Math.min(1, Math.max(0, (elapsed - (delays.get(id) ?? 0)) / ms))
        if (t < 1) done = false
        const e = easeInOutCubic(t)
        frame[id] = { x: from[id].x + (to[id].x - from[id].x) * e, y: from[id].y + (to[id].y - from[id].y) * e }
      }
      store.setPositions(done ? to : frame)
      if (!done) tweenFrame.current = requestAnimationFrame(step)
    }
    tweenFrame.current = requestAnimationFrame(step)
  }

  /** Só enquadra de novo se, depois do rearranjo, parte relevante do grafo ficaria fora da área visível. */
  const fitIfNeeded = (positions: Positions) => {
    const area = workspaceRef.current?.getBoundingClientRect()
    if (!area) return
    const b = boundsOf(data.contents, positions)
    const tl = flowToScreenPosition({ x: b.x, y: b.y })
    const br = flowToScreenPosition({ x: b.x + b.width, y: b.y + b.height })
    const desktop = isDesktop()
    const inside =
      tl.x >= area.left + 12 &&
      br.x <= area.right - (selected && desktop ? PANEL_SPACE : 12) &&
      tl.y >= area.top + 56 &&
      br.y <= area.bottom - DOCK_SPACE
    if (inside) return
    fitBounds({ ...b, height: b.height * 1.12 }, { padding: 0.08, duration: motionDuration(MOTION.camera) })
  }

  /**
   * Reorganizar. Padrão: gentil (parte das posições atuais, minimiza deslocamento, respeita nós âncora e posições manuais).
   * Com Shift: recálculo completo do zero (comportamento anterior), que também reenquadra a câmera.
   */
  const relayout = (fromScratch = false) => {
    if (fromScratch) {
      const target = store.computeRelayout()
      tweenPositions(data.positions, target)
      const bounds = boundsOf(data.contents, target)
      // fitBounds só aceita margem numérica: reserva espaço extra embaixo para a barra de controles.
      fitBounds({ ...bounds, height: bounds.height * 1.12 }, { padding: 0.08, duration: motionDuration(MOTION.relayout) })
      return
    }
    const result = organizeGraph({
      contents: data.contents,
      relations: data.relations,
      positions: data.positions,
      pinned: new Set(data.pinned),
    })
    if (!result) {
      notify('O grafo já está bem organizado. Shift + clique em Reorganizar refaz tudo do zero.')
      return
    }
    tweenPositions(data.positions, result.positions)
    fitIfNeeded(result.positions)
  }

  // ---- Menu de contexto ----
  const closeMenu = useCallback(() => setMenu(null), [])
  const openPaneMenu = (x: number, y: number) => setMenu({ kind: 'pane', x, y, flow: screenToFlowPosition({ x, y }) })
  const openNodeMenu = (x: number, y: number, nodeId: string) =>
    setMenu(effGroup.length >= 2 && effGroup.includes(nodeId) ? { kind: 'group', x, y } : { kind: 'node', x, y, nodeId })

  const askDelete = (ids: string[]) => setDeleteTargets(data.contents.filter((c) => ids.includes(c.id)))

  /** Itens do menu atual (apenas dados; as ações são tratadas em `runMenuAction`). */
  const menuItems = (): { title?: string; items: MenuItem[] } => {
    if (!menu) return { items: [] }
    if (menu.kind === 'pane') {
      return {
        items: [
          { key: 'novo', label: 'Novo conteúdo', icon: <Plus size={15} /> },
          { key: 'area', label: 'Selecionar área', hint: 'Arrastar no vazio', icon: <BoxSelect size={15} /> },
          { key: 'organizar', label: 'Organizar visualização', icon: <Wand2 size={15} /> },
        ],
      }
    }
    if (menu.kind === 'group') {
      return {
        title: `${effGroup.length} selecionados`,
        items: [
          { key: 'dup', label: 'Duplicar selecionados', icon: <Copy size={15} /> },
          { key: 'del', label: 'Excluir selecionados', icon: <Trash2 size={15} />, danger: true },
        ],
      }
    }
    return {
      items: [
        { key: 'abrir', label: 'Abrir', icon: <PanelRightOpen size={15} /> },
        { key: 'editar', label: 'Editar', icon: <Pencil size={15} /> },
        { key: 'dup', label: 'Duplicar', icon: <Copy size={15} /> },
        { key: 'del', label: 'Excluir', icon: <Trash2 size={15} />, danger: true },
      ],
    }
  }

  const runMenuAction = (key: string) => {
    if (!menu) return
    if (menu.kind === 'pane') {
      if (key === 'novo') setForm({ mode: 'new', at: menu.flow })
      else if (key === 'area') notify('Arraste com o botão esquerdo em uma área vazia para selecionar. O botão do meio move a tela.')
      else if (key === 'organizar') relayout(false)
      return
    }
    const ids = menu.kind === 'group' ? effGroup : [menu.nodeId]
    if (key === 'dup') duplicate(ids)
    else if (key === 'del') askDelete(ids)
    else if (key === 'abrir') goTo(ids[0])
    else if (key === 'editar') setForm({ mode: 'edit', id: ids[0] })
  }

  // Delete/Backspace abrem a confirmação de exclusão da seleção (nunca excluem direto, nunca durante digitação).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], .popover')) return
      if (form || restoreOpen || deleteTargets || menu) return
      const ids = effGroup.length >= 2 ? effGroup : selected ? [selected.id] : []
      if (ids.length === 0) return
      e.preventDefault()
      askDelete(ids)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, restoreOpen, deleteTargets, menu, effGroup, selected, data.contents])

  const highlightIds = useMemo(() => {
    const ids = new Set(flash)
    if (menu?.kind === 'node') ids.add(menu.nodeId)
    return ids
  }, [flash, menu])

  const availableTypes = useMemo(() => CONTENT_TYPES.filter((t) => data.contents.some((c) => c.type === t)), [data.contents])

  const refreshData = async () => {
    const ok = await store.reload()
    if (ok) notify('Dados atualizados.')
  }

  const restoreDemo = () => {
    cancelAnimationFrame(tweenFrame.current ?? 0)
    store.resetDemo()
    setRestoreOpen(false)
    clearFilters()
    setSelectedId(null)
    window.setTimeout(() => fitView({ ...FIT_OPTIONS, duration: motionDuration(MOTION.camera) }), 80)
  }

  if (store.live && store.status !== 'ready') {
    return store.status === 'loading' ? (
      <div className="boot" role="status" aria-live="polite">
        <div className="boot-pulse" aria-hidden="true" />
        <p>Carregando conhecimento…</p>
      </div>
    ) : (
      <div className="fatal" role="alert">
        <AlertTriangle size={24} aria-hidden="true" />
        <h1>Não foi possível carregar os dados da monday.</h1>
        <p>{store.loadError?.message}</p>
        <div className="fatal-actions">
          <button type="button" className="btn btn-primary" onClick={() => void store.retry()}>
            Tentar novamente
          </button>
          {ALLOW_MOCK_FALLBACK && (
            <button type="button" className="btn btn-ghost" onClick={() => void store.useDemo()}>
              Usar demonstração
            </button>
          )}
        </div>
      </div>
    )
  }

  if (store.demoError) {
    return (
      <div className="fatal" role="alert">
        <AlertTriangle size={24} aria-hidden="true" />
        <h1>Pacote de demonstração inválido</h1>
        <p>{store.demoError}</p>
      </div>
    )
  }

  const editing = form?.mode === 'edit' ? (data.contents.find((c) => c.id === form.id) ?? null) : null

  return (
    <div className="app">
      <TopBar
        searchBox={
          <SearchBox
            value={filters.query}
            onChange={(query) => applyFilters({ ...filters, query })}
            onClear={clearSearch}
            inputRef={searchInputRef}
            results={visibleContents}
            info={result.info}
            searching={queryActive}
            onPick={goTo}
            onPreview={setPreviewId}
          />
        }
        filterMenu={
          <FilterMenu
            filters={filters}
            activeCount={countActiveFilters(filters)}
            visibleCount={visibleContents.length}
            totalCount={data.contents.length}
            onChange={applyFilters}
            onClear={clearFilters}
            types={availableTypes}
          />
        }
        onNew={() => setForm({ mode: 'new' })}
        onRestoreDemo={store.live ? undefined : () => setRestoreOpen(true)}
        onRefresh={store.live ? refreshData : undefined}
        refreshing={store.refreshing}
        sourceBadge={store.live ? 'Dados da monday' : 'Demonstração'}
        menuNote={store.live && store.meta ? `Atualizado às ${new Date(store.meta.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : undefined}
      />

      {store.saveError && (
        <div className="banner banner-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Não foi possível salvar as alterações: {store.saveError} Elas continuam na tela, mas podem ser perdidas ao
            recarregar.
          </span>
        </div>
      )}
      {store.notice && (
        <div className="banner" role="status">
          <span>{store.notice}</span>
          <button type="button" className="icon-btn" aria-label="Dispensar aviso" onClick={store.dismissNotice}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <main className="workspace" ref={workspaceRef}>
        <GraphView
          contents={data.contents}
          relations={data.relations}
          positions={data.positions}
          presentIds={visibleIds}
          matchedIds={matchedIds}
          queryActive={queryActive}
          previewId={previewId}
          freshEdgeId={fresh?.edgeId ?? null}
          pulseId={fresh?.nodeId ?? null}
          bornIds={bornIds}
          groupIds={effGroup}
          highlightIds={highlightIds}
          onSelectionChange={setSelection}
          onPaneMenu={openPaneMenu}
          onNodeMenu={openNodeMenu}
          onConnect={connectNodes}
          onNotify={notify}
          onRemoveRelation={removeRelation}
          matchInfo={result.info}
          resultMode={hasActiveFilters(logicalFilters)}
          selectedId={selected?.id ?? null}
          onSelect={selectFromGraph}
          onMove={store.movePosition}
          onPin={store.pinNode}
          onRelayout={relayout}
        />
        <ActiveFilters
          filters={logicalFilters}
          visibleCount={visibleContents.length}
          totalCount={data.contents.length}
          onChange={(next) => applyFilters({ ...next, query: filters.query === logicalFilters.query ? next.query : filters.query })}
          onClear={clearFilters}
          onFrame={frameResults}
        />
        {visibleContents.length === 0 && (
          <EmptyResults
            query={logicalFilters.query.trim()}
            filters={logicalFilters}
            onClearSearch={clearSearch}
            onClearFilters={clearOtherFilters}
          />
        )}
        {panelContent && (
          <DetailPanel
            closing={closing}
            content={panelContent}
            contents={data.contents}
            relations={data.relations}
            visibleIds={visibleIds}
            onClose={() => setSelectedId(null)}
            onEdit={() => setForm({ mode: 'edit', id: panelContent.id })}
            onDelete={() => setDeleteTargets([panelContent])}
            onGoTo={goTo}
            onReveal={reveal}
          />
        )}
      </main>

      {form && (form.mode === 'new' || editing) && (
        <ContentForm
          existing={editing}
          contents={data.contents}
          relations={data.relations}
          onCancel={() => setForm(null)}
          onSave={handleSave}
        />
      )}

      {deleteTargets && deleteTargets.length > 0 && (
        <ConfirmDialog
          title={deleteTargets.length === 1 ? `Excluir “${deleteTargets[0].title}”?` : `Excluir ${deleteTargets.length} conteúdos?`}
          confirmLabel={deleteTargets.length === 1 ? 'Excluir' : `Excluir ${deleteTargets.length}`}
          onCancel={() => setDeleteTargets(null)}
          onConfirm={confirmDelete}
        >
          <p>
            {deleteTargets.length === 1
              ? 'Este conteúdo e suas conexões serão removidos. Esta ação não pode ser desfeita.'
              : 'As conexões associadas também serão removidas. Esta ação não pode ser desfeita.'}
          </p>
        </ConfirmDialog>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} title={menuItems().title} items={menuItems().items} onAction={runMenuAction} onClose={closeMenu} />}

      {toast && <Toast key={toast.id} text={toast.text} />}

      {restoreOpen && (
        <ConfirmDialog
          title="Restaurar demonstração?"
          confirmLabel="Restaurar"
          onCancel={() => setRestoreOpen(false)}
          onConfirm={restoreDemo}
        >
          <p>
            Os conteúdos, vínculos e posições salvos neste navegador serão substituídos pelos dados originais da
            demonstração. Esta ação não pode ser desfeita.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  )
}
