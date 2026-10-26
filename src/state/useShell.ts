import { useCallback, useState } from 'react'
import type { BrainConfig, ViewId } from '../brains/types'
import { getBrain, resolveBrainId } from '../brains/registry'

/** Preferências de interface (nunca misturadas com os dados da monday). */
const SIDEBAR_KEY = 'squadhub:segundo-cerebro:ui:sidebarCollapsed'
const BRAIN_KEY = 'squadhub:segundo-cerebro:ui:activeBrain'
const ASSISTANT_KEY = 'squadhub:segundo-cerebro:ui:assistantOpen'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* preferência não essencial */
  }
}

/** Sem preferência salva, telas estreitas começam com a barra lateral recolhida. */
function initialCollapsed(): boolean {
  const saved = read(SIDEBAR_KEY)
  if (saved === '1') return true
  if (saved === '0') return false
  return window.matchMedia('(max-width: 899px)').matches
}

/**
 * Navegação do app: cérebro ativo, tela atual (mapa ou conexões) e barra lateral. A tela é estado interno (sem router);
 * `ViewId` já permite migrar para rotas depois.
 */
export function useShell() {
  const [activeBrainId, setActiveBrainId] = useState(() => resolveBrainId(read(BRAIN_KEY)))
  // Tela atual (mapa ou conexões) guardada POR cérebro: alternar entre cérebros devolve cada um à tela em que estava.
  const [views, setViews] = useState<Record<string, ViewId>>({})
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [assistantOpen, setAssistantOpen] = useState(() => read(ASSISTANT_KEY) === '1' && !window.matchMedia('(max-width: 899px)').matches)

  const brain: BrainConfig = getBrain(activeBrainId)
  const view: ViewId = views[activeBrainId] ?? 'map'
  const setView = useCallback((next: ViewId) => setViews((v) => ({ ...v, [activeBrainId]: next })), [activeBrainId])

  /** Troca de cérebro (somente os habilitados). Volta para o mapa. Retorna se a troca ocorreu. */
  const setActiveBrain = useCallback((id: string): boolean => {
    const next = resolveBrainId(id)
    if (next !== id) return false
    setActiveBrainId(next)
    write(BRAIN_KEY, next)
    return true
  }, [])

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      write(SIDEBAR_KEY, c ? '0' : '1')
      return !c
    })
  }, [])

  const toggleAssistant = useCallback(() => {
    setAssistantOpen((o) => {
      write(ASSISTANT_KEY, o ? '0' : '1')
      return !o
    })
  }, [])

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false)
    write(ASSISTANT_KEY, '0')
  }, [])

  return { brain, activeBrainId, setActiveBrain, view, setView, sidebarCollapsed: collapsed, toggleSidebar, assistantOpen, toggleAssistant, closeAssistant }
}
