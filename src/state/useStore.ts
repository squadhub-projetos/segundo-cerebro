import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppData, Content, GraphPayloadMeta, Position, Positions, Relation } from '../types'
import { COLLECTIONS, THEMES, buildDemoData, setTaxonomy, validateDemo } from '../lib/mock'
import { computeLayout } from '../lib/layout'
import { copyTitle, planDuplicateOffset } from '../lib/duplicate'
import { placeNode } from '../lib/spatial'
import { inferRelation, newId, validateRelation } from '../lib/relations'
import { loadLive, loadState, saveLive, saveState } from '../lib/storage'
import { IS_LIVE } from '../data/source'
import { emptyData, isRemoteRelation, mergeRemote, overlayOf } from '../data/merge'
import { mockProvider, mondayProvider } from '../data/providers'
import { mondayWriter } from '../data/providers/mondayWriter'
import type { WritableKind } from '../data/providers/mondayWriter'

export type LinkDraft = Pick<Relation, 'source' | 'target' | 'type'>
export type SaveResult = { ok: true; id: string; warning?: string } | { ok: false; error: string }
export type ConnectResult = { ok: true; relation: Relation } | { ok: false; error: string }
export type SimpleResult = { ok: true } | { ok: false; error: string }

const UNSUPPORTED = 'Este tipo de conexão ainda não possui armazenamento configurado na monday.'
const WRITABLE: Content['type'][] = ['infoproduto', 'aula', 'youtube']
const itemIdOf = (c: Content | undefined) => c?.sourceIds?.[0]
const relationId = (r: Pick<Relation, 'type' | 'source' | 'target'>) => `rel:${r.type}:${r.source}>${r.target}`
const reason = (prefix: string, error: unknown) => `${prefix} ${(error as Error)?.message ?? 'Erro desconhecido.'}`

/**
 * Aula ↔ Infoproduto (relação `contem-aula`, infoproduto → aula) e Vídeo ↔ Infoproduto (`divulga`, vídeo → infoproduto) são
 * as únicas conexões com armazenamento definido na monday. Retorna qual lado é gravado (sempre a aula/o vídeo).
 */
function writeTarget(contents: Content[], link: Pick<Relation, 'source' | 'target' | 'type'>) {
  const s = contents.find((c) => c.id === link.source)
  const t = contents.find((c) => c.id === link.target)
  if (!s || !t) return null
  if (link.type === 'contem-aula' && s.type === 'infoproduto' && t.type === 'aula') return { childType: 'aula' as const, child: t, info: s }
  if (link.type === 'divulga' && s.type === 'youtube' && t.type === 'infoproduto') return { childType: 'youtube' as const, child: s, info: t }
  return null
}

const SAVE_DEBOUNCE_MS = 400

interface Initial {
  data: AppData
  notice: string | null
}

function loadInitial(): Initial {
  const loaded = loadState()
  if (loaded.kind === 'ok') return { data: loaded.data, notice: null }
  const notice =
    loaded.kind === 'invalid'
      ? `Os dados salvos neste navegador não puderam ser lidos (${loaded.reason}). A demonstração foi carregada.`
      : null
  return { data: buildDemoData(), notice }
}

export type LoadStatus = 'loading' | 'ready' | 'error'
export interface LoadError {
  code: string
  message: string
}

/**
 * Estado da aplicação: conteúdos, relações e posições.
 *  - Fonte `mock`: tudo persiste no localStorage (demonstração).
 *  - Fonte `monday`: conteúdos e relações vêm da API e as alterações são gravadas na monday (via /api/mutate) antes de
 *    aparecer no mapa. No navegador fica apenas a camada LOCAL de layout (posições e fixações).
 */
export function useStore() {
  const live = IS_LIVE
  const [initial] = useState(() => (live ? { data: emptyData(), notice: null } : loadInitial()))
  const [demoError] = useState(() => (live ? null : validateDemo()))
  const [data, setData] = useState<AppData>(initial.data)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(initial.notice)
  const [status, setStatus] = useState<LoadStatus>(live ? 'loading' : 'ready')
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [meta, setMeta] = useState<GraphPayloadMeta | null>(null)
  const latest = useRef(data)
  const statusRef = useRef(status)
  const started = useRef(false)

  useEffect(() => {
    latest.current = data
    statusRef.current = status
    // Com dados live, nada é gravado antes do primeiro carregamento bem-sucedido.
    if (live && status !== 'ready') return
    const timer = window.setTimeout(() => setSaveError(live ? saveLive(overlayOf(data)) : saveState(data)), SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [data, status, live])

  // Garante a gravação de alterações pendentes ao sair da página.
  useEffect(() => {
    const flush = () => {
      if (live) {
        if (statusRef.current === 'ready') saveLive(overlayOf(latest.current))
      } else saveState(latest.current)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [live])

  /** Carrega (ou recarrega) os dados remotos e os junta à camada local. Retorna se deu certo. */
  const load = useCallback(async (options: { refresh: boolean; demo?: boolean }): Promise<boolean> => {
    const first = statusRef.current !== 'ready'
    if (first) setStatus('loading')
    else setRefreshing(true)
    setLoadError(null)
    try {
      const payload = await (options.demo ? mockProvider : mondayProvider).load({ refresh: options.refresh })
      const overlay = first ? loadLive() : overlayOf(latest.current)
      if (import.meta.env.DEV) {
        const count = (t: string) => payload.contents.filter((c) => c.type === t).length
        console.info(
          `[SecondBrain] datasource: ${options.demo ? 'mock' : 'monday'} | contents: ${payload.contents.length} (infoproduto ${count('infoproduto')}, aula ${count('aula')}, youtube ${count('youtube')}) | relations: ${payload.relations.length} (aula↔infoproduto ${payload.meta.relationStats?.contemAula.unique ?? '?'}, vídeo↔infoproduto ${payload.meta.relationStats?.divulga.unique ?? '?'}, ignoradas ${payload.meta.relationStats?.ignored ?? '?'}) | collections: ${payload.collections.length}`,
        )
      }
      setData(mergeRemote(payload, overlay))
      setMeta(payload.meta)
      setStatus('ready')
      return true
    } catch (error) {
      const e = error as { code?: string; message?: string }
      const failure = { code: e.code ?? 'unknown', message: e.message ?? 'Erro desconhecido.' }
      setLoadError(failure)
      if (first) setStatus('error')
      else setNotice(`Não foi possível atualizar os dados da monday (${failure.message}). Mantendo os dados atuais.`)
      return false
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!live || started.current) return
    started.current = true
    void load({ refresh: false })
  }, [live, load])

  const movePosition = useCallback((id: string, position: Position) => {
    setData((d) => ({ ...d, positions: { ...d.positions, [id]: position } }))
  }, [])

  const saveLocal = useCallback(
    (content: Content, links: LinkDraft[], hint?: Position): SaveResult => {
      const isNew = !data.contents.some((c) => c.id === content.id)
      const anchorLink = links[0]
      const anchorId = anchorLink ? (anchorLink.source === content.id ? anchorLink.target : anchorLink.source) : undefined

      let saved = content
      if (isNew && !content.collectionId && anchorId) {
        saved = { ...content, collectionId: data.contents.find((c) => c.id === anchorId)?.collectionId ?? null }
      }
      const contents = isNew ? [...data.contents, saved] : data.contents.map((c) => (c.id === saved.id ? saved : c))

      const relations = data.relations.filter((r) => r.source !== saved.id && r.target !== saved.id)
      for (const link of links) {
        if (link.source !== saved.id && link.target !== saved.id) {
          return { ok: false, error: 'O vínculo precisa envolver este conteúdo.' }
        }
        const error = validateRelation(link, contents, relations)
        if (error) return { ok: false, error }
        const previous = data.relations.find(
          (r) => r.source === link.source && r.target === link.target && r.type === link.type,
        )
        relations.push({ id: previous?.id ?? newId('rel'), ...link, relationSource: previous?.relationSource ?? 'local' })
      }

      const positions = { ...data.positions }
      if (isNew) {
        // Colocação local por custo: perto dos vizinhos (ou do foco), sem colisão e sem arestas atravessando cards.
        const own = relations.filter((r) => r.source === saved.id || r.target === saved.id)
        positions[saved.id] = placeNode(
          { contents: data.contents, relations: data.relations, positions: data.positions, pinned: new Set(data.pinned) },
          { content: saved, relations: own, hint },
        ).position
      }
      setData({ contents, relations, positions, pinned: data.pinned })
      return { ok: true, id: saved.id }
    },
    [data],
  )

  /** Conecta dois conteúdos pelo mapa: tipo e direção são inferidos; duplicatas são recusadas. */
  const connectLocal = useCallback(
    (aId: string, bId: string): ConnectResult => {
      const inferred = inferRelation(data.contents, data.relations, aId, bId)
      if (!inferred.ok) return { ok: false, error: inferred.reason }
      const relation: Relation = { id: newId('rel'), ...inferred.relation, relationSource: 'local' }
      // Conteúdo sem conjunto herda o conjunto de quem ele acabou de ligar (mantém o agrupamento visual coerente).
      const a = data.contents.find((c) => c.id === aId)
      const b = data.contents.find((c) => c.id === bId)
      setData((d) => ({
        ...d,
        relations: [...d.relations, relation],
        contents: d.contents.map((c) => {
          if (c.collectionId) return c
          if (c.id === aId && b?.collectionId) return { ...c, collectionId: b.collectionId }
          if (c.id === bId && a?.collectionId) return { ...c, collectionId: a.collectionId }
          return c
        }),
      }))
      return { ok: true, relation }
    },
    [data.contents, data.relations],
  )

  /** Remove apenas o vínculo; nenhum conteúdo é excluído. Com dados live, a ligação é removida da monday primeiro. */
  const removeRelation = useCallback(
    async (id: string): Promise<SimpleResult> => {
      const d = latest.current
      const rel = d.relations.find((r) => r.id === id)
      if (!rel) return { ok: false, error: 'Conexão não encontrada.' }
      if (isRemoteRelation(rel)) {
        const target = writeTarget(d.contents, rel)
        const childItem = itemIdOf(target?.child)
        const infoItem = itemIdOf(target?.info)
        if (!target || !childItem || !infoItem) return { ok: false, error: UNSUPPORTED }
        try {
          await mondayWriter.unlink(target.childType, childItem, infoItem)
        } catch (error) {
          return { ok: false, error: reason('Erro ao remover a conexão na monday.', error) }
        }
      }
      setData((cur) => ({ ...cur, relations: cur.relations.filter((r) => r.id !== id) }))
      return { ok: true }
    },
    [],
  )

  /** Remove do estado local conteúdos, suas relações e posições (a monday já foi atualizada quando houver). */
  const deleteContents = useCallback((ids: string[]) => {
    setData((d) => {
      const gone = new Set(ids)
      const positions = { ...d.positions }
      for (const id of gone) delete positions[id]
      return {
        contents: d.contents.filter((c) => !gone.has(c.id)),
        relations: d.relations.filter((r) => !gone.has(r.source) && !gone.has(r.target)),
        positions,
        pinned: d.pinned.filter((p) => !gone.has(p)),
      }
    })
  }, [])

  /**
   * Duplica conteúdos (sem relações). O grupo inteiro é deslocado junto, preservando as posições relativas, para o lado
   * livre mais próximo. Retorna os IDs das cópias.
   */
  const duplicateLocal = useCallback(
    (ids: string[]): string[] => {
      const originals = data.contents.filter((c) => ids.includes(c.id) && data.positions[c.id])
      if (originals.length === 0) return []
      const offset = planDuplicateOffset(data.contents, data.positions, originals.map((c) => c.id))
      const titles = new Set(data.contents.map((c) => c.title))
      const copies: Content[] = []
      const positions = { ...data.positions }
      for (const o of originals) {
        const title = copyTitle(o.title, titles)
        titles.add(title)
        const copy: Content = {
          ...o,
          id: newId('conteudo'),
          title,
          themes: [...o.themes],
          isMock: false,
          // A cópia é um conteúdo LOCAL: não aponta para o item da monday.
          source: o.source === 'monday' ? 'local' : o.source,
          sourceIds: undefined,
          sourceUrl: undefined,
          normalizedKey: undefined,
        }
        copies.push(copy)
        positions[copy.id] = { x: Math.round(data.positions[o.id].x + offset.x), y: Math.round(data.positions[o.id].y + offset.y) }
      }
      setData((d) => ({ ...d, contents: [...d.contents, ...copies], positions: { ...d.positions, ...Object.fromEntries(copies.map((c) => [c.id, positions[c.id]])) } }))
      return copies.map((c) => c.id)
    },
    [data.contents, data.positions],
  )

  /* ---------------------------------------------------------------- escrita na monday (modo live) */

  /** Cria (ou edita) um item na monday e só então atualiza o estado local. IDs definitivos vêm da monday. */
  const saveRemote = useCallback(
    async (content: Content, links: LinkDraft[], hint?: Position): Promise<SaveResult> => {
      const d = latest.current
      const existing = d.contents.find((c) => c.id === content.id)
      if (!WRITABLE.includes(content.type)) return { ok: false, error: UNSUPPORTED }
      const kind = content.type as WritableKind
      const base = existing ? d.contents : [...d.contents, content]
      const others = d.relations.filter((r) => r.source !== content.id && r.target !== content.id)
      for (const link of links) {
        if (link.source !== content.id && link.target !== content.id) return { ok: false, error: 'O vínculo precisa envolver este conteúdo.' }
        const error = validateRelation(link, base, others)
        if (error) return { ok: false, error }
        if (!writeTarget(base, link)) return { ok: false, error: UNSUPPORTED }
      }
      const otherOf = (l: LinkDraft) => base.find((c) => c.id === (l.source === content.id ? l.target : l.source))
      const wantedKey = (l: LinkDraft) => `${l.source}>${l.target}>${l.type}`
      let warning: string | undefined
      const adoptThemes = (themes?: { id: string; label: string }[]) => {
        const fresh = (themes ?? []).filter((t) => !THEMES.some((x) => x.id === t.id))
        if (fresh.length) setTaxonomy([...THEMES, ...fresh], COLLECTIONS)
      }

      if (!existing) {
        const createLinks: { type: WritableKind; itemId: string }[] = []
        for (const l of links) {
          const other = otherOf(l)
          const itemId = itemIdOf(other)
          if (!other || !itemId) return { ok: false, error: UNSUPPORTED }
          createLinks.push({ type: other.type as WritableKind, itemId })
        }
        let created
        try {
          created = await mondayWriter.create(kind, content.title, kind === 'aula' ? content.description : undefined, createLinks)
        } catch (error) {
          return { ok: false, error: reason('Erro ao criar o conteúdo na monday.', error) }
        }
        if (!created.content) return { ok: false, error: 'A monday não retornou o item criado.' }
        warning = created.warning
        adoptThemes(created.themes)
        const anchor = links[0] ? otherOf(links[0]) : undefined
        const saved: Content = { ...created.content, collectionId: anchor?.collectionId ?? null }
        const newRelations: Relation[] = links.map((l) => {
          const link = { source: l.source === content.id ? saved.id : l.source, target: l.target === content.id ? saved.id : l.target, type: l.type }
          return { id: relationId(link), ...link, relationSource: 'monday' as const }
        })
        const cur = latest.current
        const position = placeNode(
          { contents: cur.contents, relations: cur.relations, positions: cur.positions, pinned: new Set(cur.pinned) },
          { content: saved, relations: newRelations, hint },
        ).position
        setData((c) => ({
          ...c,
          contents: [...c.contents, saved],
          relations: [...c.relations, ...newRelations],
          positions: { ...c.positions, [saved.id]: position },
        }))
        return { ok: true, id: saved.id, warning }
      }

      // Edição: só os campos alterados e só os vínculos que mudaram.
      let current = existing
      const fields: { title?: string; description?: string } = {}
      if (content.title !== existing.title) fields.title = content.title
      if (kind === 'aula' && content.description !== existing.description) fields.description = content.description
      let failure: string | undefined
      if (Object.keys(fields).length) {
        try {
          const updated = await mondayWriter.update(kind, itemIdOf(existing) ?? '', fields)
          if (updated.content) current = { ...updated.content, id: existing.id, collectionId: existing.collectionId }
          adoptThemes(updated.themes)
        } catch (error) {
          return { ok: false, error: reason('Erro ao salvar a alteração na monday.', error) }
        }
      }
      let relations = d.relations
      const mine = d.relations.filter((r) => r.source === existing.id || r.target === existing.id)
      const wanted = new Set(links.map(wantedKey))
      const have = new Set(mine.map(wantedKey))
      const removals = mine.filter((r) => !wanted.has(wantedKey(r)))
      const additions = links.filter((l) => !have.has(wantedKey(l)))
      for (const r of removals) {
        const t = writeTarget(base, r)
        try {
          if (!t || !itemIdOf(t.child) || !itemIdOf(t.info)) throw new Error(UNSUPPORTED)
          await mondayWriter.unlink(t.childType, itemIdOf(t.child)!, itemIdOf(t.info)!)
          relations = relations.filter((x) => x.id !== r.id)
        } catch (error) {
          failure = reason('Erro ao remover uma conexão na monday.', error)
          break
        }
      }
      if (!failure) {
        for (const l of additions) {
          const t = writeTarget(base, l)
          try {
            if (!t || !itemIdOf(t.child) || !itemIdOf(t.info)) throw new Error(UNSUPPORTED)
            await mondayWriter.link(t.childType, itemIdOf(t.child)!, itemIdOf(t.info)!)
            relations = [...relations, { id: relationId(l), source: l.source, target: l.target, type: l.type, relationSource: 'monday' }]
          } catch (error) {
            failure = reason('Erro ao criar uma conexão na monday.', error)
            break
          }
        }
      }
      setData((c) => ({ ...c, contents: c.contents.map((x) => (x.id === current.id ? current : x)), relations }))
      return failure ? { ok: false, error: failure } : { ok: true, id: existing.id }
    },
    [],
  )

  /** Conexão pelo mapa em modo live: grava na monday e só então desenha. Só Aula/Vídeo ↔ Infoproduto têm armazenamento. */
  const connectRemote = useCallback(async (aId: string, bId: string): Promise<ConnectResult> => {
    const d = latest.current
    const a = d.contents.find((c) => c.id === aId)
    const b = d.contents.find((c) => c.id === bId)
    if (!a || !b) return { ok: false, error: 'Conteúdo não encontrado.' }
    const inferred = inferRelation(d.contents, d.relations, aId, bId)
    const link = inferred.ok ? inferred.relation : null
    const target = link ? writeTarget(d.contents, link) : null
    if (!inferred.ok) return { ok: false, error: /não podem ser conectados/.test(inferred.reason) ? UNSUPPORTED : inferred.reason }
    if (!link || !target) return { ok: false, error: UNSUPPORTED }
    const childItem = itemIdOf(target.child)
    const infoItem = itemIdOf(target.info)
    if (!childItem || !infoItem) return { ok: false, error: UNSUPPORTED }
    try {
      await mondayWriter.link(target.childType, childItem, infoItem)
    } catch (error) {
      return { ok: false, error: reason('Erro ao criar a conexão na monday.', error) }
    }
    const relation: Relation = { id: relationId(link), ...link, relationSource: 'monday' }
    setData((cur) => ({
      ...cur,
      relations: cur.relations.some((r) => r.id === relation.id) ? cur.relations : [...cur.relations, relation],
      contents: cur.contents.map((c) => {
        if (c.collectionId) return c
        if (c.id === aId && b.collectionId) return { ...c, collectionId: b.collectionId }
        if (c.id === bId && a.collectionId) return { ...c, collectionId: a.collectionId }
        return c
      }),
    }))
    return { ok: true, relation }
  }, [])

  /** Exclui na monday (delete_item). Retorna os ids realmente excluídos; quem falhar permanece no mapa. */
  const deleteRemote = useCallback(async (ids: string[]): Promise<{ deleted: string[]; error?: string }> => {
    const deleted: string[] = []
    let error: string | undefined
    for (const id of ids) {
      const c = latest.current.contents.find((x) => x.id === id)
      const itemId = itemIdOf(c)
      if (!c || !itemId || !WRITABLE.includes(c.type)) {
        deleted.push(id) // conteúdo local (sem item na monday)
        continue
      }
      try {
        await mondayWriter.remove(c.type as WritableKind, itemId)
        deleted.push(id)
      } catch (e) {
        error = reason(`Erro ao excluir “${c.title}” na monday.`, e)
      }
    }
    return { deleted, error }
  }, [])

  /** Duplica na monday (novo item no mesmo quadro, sem relações) e posiciona a cópia ao lado do original. */
  const duplicateRemote = useCallback(async (ids: string[]): Promise<{ ids: string[]; error?: string }> => {
    const d = latest.current
    const originals = d.contents.filter((c) => ids.includes(c.id) && d.positions[c.id] && itemIdOf(c))
    if (originals.length === 0) return { ids: [] }
    const offset = planDuplicateOffset(d.contents, d.positions, originals.map((c) => c.id))
    const copies: Content[] = []
    let error: string | undefined
    for (const o of originals) {
      try {
        const r = await mondayWriter.duplicate(o.type as WritableKind, itemIdOf(o)!)
        if (r.content) copies.push({ ...r.content, collectionId: o.collectionId })
      } catch (e) {
        error = reason(`Erro ao duplicar “${o.title}” na monday.`, e)
      }
    }
    if (copies.length) {
      setData((cur) => {
        const positions = { ...cur.positions }
        copies.forEach((c, i) => {
          const o = originals[i]
          positions[c.id] = { x: Math.round(cur.positions[o.id].x + offset.x), y: Math.round(cur.positions[o.id].y + offset.y) }
        })
        return { ...cur, contents: [...cur.contents, ...copies], positions }
      })
    }
    return { ids: copies.map((c) => c.id), error }
  }, [])

  const saveContent = useCallback(
    (content: Content, links: LinkDraft[], hint?: Position): Promise<SaveResult> =>
      live ? saveRemote(content, links, hint) : Promise.resolve(saveLocal(content, links, hint)),
    [live, saveRemote, saveLocal],
  )
  const connect = useCallback(
    (aId: string, bId: string): Promise<ConnectResult> => (live ? connectRemote(aId, bId) : Promise.resolve(connectLocal(aId, bId))),
    [live, connectRemote, connectLocal],
  )
  const duplicateContents = useCallback(
    async (ids: string[]): Promise<{ ids: string[]; error?: string }> => (live ? duplicateRemote(ids) : { ids: duplicateLocal(ids) }),
    [live, duplicateRemote, duplicateLocal],
  )

  /** Calcula um novo layout para todo o grafo sem aplicá-lo (a animação aplica os quadros). */
  const computeRelayout = useCallback(
    (): Positions => computeLayout(data.contents, data.relations),
    [data.contents, data.relations],
  )

  /** Substitui todas as posições; usado pela animação de reorganização. */
  /** Marca um nó como posicionado manualmente (ao soltar um arraste). */
  const pinNode = useCallback((id: string) => {
    setData((d) => (d.pinned.includes(id) ? d : { ...d, pinned: [...d.pinned, id] }))
  }, [])

  const setPositions = useCallback((positions: Positions) => {
    setData((d) => ({ ...d, positions }))
  }, [])

  const resetDemo = useCallback(() => {
    setData(buildDemoData())
    setNotice(null)
  }, [])

  return {
    data,
    demoError,
    saveError,
    notice,
    dismissNotice: () => setNotice(null),
    movePosition,
    saveContent,
    connect,
    removeRelation,
    deleteContents,
    deleteRemote,
    duplicateContents,
    computeRelayout,
    setPositions,
    pinNode,
    resetDemo,
    live,
    status,
    loadError,
    refreshing,
    meta,
    reload: () => load({ refresh: true }),
    retry: () => load({ refresh: true }),
    useDemo: () => load({ refresh: false, demo: true }),
  }
}
