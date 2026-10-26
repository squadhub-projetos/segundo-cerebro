import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import type { BrainConfig, BrainConnection, BrainNodeType } from '../../brains/types'
import type { SchemaPayload } from '../../types/schema'
import { ConnectionDialog, InitDialog, NodeTypeDialog } from './StructureDialogs'

export interface ConnectionPrefill {
  source?: string
  target?: string
}

interface Props {
  brain: BrainConfig
  schema: SchemaPayload | null
  /** Quantidade de itens por tipo (vem dos dados do mapa). */
  counts: Record<string, number>
  /** Origem/destino sugeridos (vindos de uma tentativa de conexão sem regra no mapa): abre o diálogo já preenchido. */
  prefill: ConnectionPrefill | null
  onPrefillConsumed: () => void
  /** Recarrega o grafo (e o schema) depois de uma alteração estrutural. */
  onChanged: (message: string) => Promise<void>
}

const STAGE_W = 720
const CARD_W = 208
const CARD_H = 112
const LEVEL_GAP = 196
const TOP = 28

/** Nível de cada tipo: o mais longo caminho a partir de uma origem (YouTube 0, Infoproduto 1, Aula 2). Seguro contra ciclos. */
function levelsOf(types: BrainNodeType[], connections: BrainConnection[]): Map<string, number> {
  const level = new Map(types.map((t) => [t.id, 0]))
  for (let pass = 0; pass < types.length; pass++) {
    for (const c of connections) {
      if (c.from === c.to) continue
      const next = (level.get(c.from) ?? 0) + 1
      if (level.has(c.to) && next > (level.get(c.to) ?? 0) && next < types.length) level.set(c.to, next)
    }
  }
  return level
}

interface Placed {
  type: BrainNodeType
  x: number
  y: number
}

const CARDINALITY: Record<NonNullable<BrainConnection['cardinality']>, string> = {
  'one-one': 'Um para um',
  'one-many': 'Um para muitos',
  'many-many': 'Muitos para muitos',
}

type Selection = { kind: 'type'; id: string } | { kind: 'connection'; id: string } | null

/**
 * Meta-grafo do cérebro: os TIPOS e as conexões permitidas entre eles (o mapa mostra os conteúdos; aqui, o modelo).
 * Hierarquia = linha contínua; associação = tracejada. Criar tipo/conexão cria board/coluna na monday pelo servidor.
 */
export function ConnectionsView({ brain, schema, counts, prefill, onPrefillConsumed, onChanged }: Props) {
  const [selection, setSelection] = useState<Selection>(null)
  // A tela é montada ao abrir "Conexões": uma tentativa de conexão sem regra no mapa já abre o diálogo preenchido.
  const [dialog, setDialog] = useState<'type' | 'connection' | 'init' | null>(() => (prefill ? 'connection' : null))
  const [connectionInitial, setConnectionInitial] = useState<ConnectionPrefill | null>(prefill)
  const { nodeTypes, connections } = brain
  const canEdit = Boolean(schema?.structure.enabled)
  const registered = Boolean(schema?.initialized)

  useEffect(() => {
    if (prefill) onPrefillConsumed()
  }, [prefill, onPrefillConsumed])

  const { placed, height } = useMemo(() => {
    const levels = levelsOf(nodeTypes, connections)
    const byLevel = new Map<number, BrainNodeType[]>()
    for (const t of nodeTypes) byLevel.set(levels.get(t.id) ?? 0, [...(byLevel.get(levels.get(t.id) ?? 0) ?? []), t])
    const out = new Map<string, Placed>()
    let maxLevel = 0
    for (const [lv, list] of byLevel) {
      maxLevel = Math.max(maxLevel, lv)
      list.forEach((type, i) => out.set(type.id, { type, x: ((i + 1) / (list.length + 1)) * STAGE_W, y: TOP + lv * LEVEL_GAP }))
    }
    return { placed: out, height: TOP * 2 + maxLevel * LEVEL_GAP + CARD_H }
  }, [nodeTypes, connections])

  const selectedType = selection?.kind === 'type' ? (nodeTypes.find((t) => t.id === selection.id) ?? null) : null
  const selectedConn = selection?.kind === 'connection' ? (connections.find((c) => c.id === selection.id) ?? null) : null
  const related = (c: BrainConnection) => (selectedType ? c.from === selectedType.id || c.to === selectedType.id : selectedConn ? c.id === selectedConn.id : true)

  const geometry = (c: BrainConnection) => {
    const a = placed.get(c.from)
    const b = placed.get(c.to)
    if (!a || !b) return null
    if (c.from === c.to) {
      // Relação dentro do mesmo tipo: laço à direita do card.
      const x = a.x + CARD_W / 2
      const y = a.y + CARD_H / 2
      return { path: `M ${x} ${y - 22} C ${x + 78} ${y - 40}, ${x + 78} ${y + 40}, ${x} ${y + 22}`, mx: x + 62, my: y }
    }
    const sameLevel = Math.abs(a.y - b.y) < 1
    const [x1, y1, x2, y2] = sameLevel
      ? [a.x + (b.x > a.x ? CARD_W / 2 : -CARD_W / 2), a.y + CARD_H / 2, b.x + (b.x > a.x ? -CARD_W / 2 : CARD_W / 2), b.y + CARD_H / 2]
      : [a.x, a.y + (b.y > a.y ? CARD_H : 0), b.x, b.y + (b.y > a.y ? 0 : CARD_H)]
    return { path: `M ${x1} ${y1} L ${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
  }

  const openConnectionDialog = () => {
    setConnectionInitial(null)
    setDialog('connection')
  }

  const editHint = canEdit ? undefined : 'Alterações estruturais estão desabilitadas neste ambiente.'

  return (
    <section className="conn-view" aria-label="Estrutura do cérebro">
      <header className="conn-head">
        <div>
          <h2>Estrutura do cérebro</h2>
          <p>
            Tipos de {brain.name} e o que pode se conectar com o quê. O mapa mostra os conteúdos; aqui está o modelo. Cada tipo é um
            board da monday e cada conexão é uma coluna Connect Boards.
          </p>
        </div>
        {nodeTypes.length > 0 && (
        <ul className="conn-legend" aria-label="Legenda">
          <li>
            <svg width="34" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="34" y2="5" className="conn-line is-hierarchy" />
            </svg>
            Hierarquia
          </li>
          <li>
            <svg width="34" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="34" y2="5" className="conn-line is-association" />
            </svg>
            Associação
          </li>
        </ul>
        )}
      </header>

      {schema && !registered && (
        <div className="conn-banner" role="status">
          <span>A estrutura ainda não está registrada na monday. Os tipos abaixo são os padrões; registre para poder criar novos tipos e conexões.</span>
          <button type="button" className="btn btn-primary" disabled={!canEdit} title={editHint} onClick={() => setDialog('init')}>
            Registrar estrutura
          </button>
        </div>
      )}

      {nodeTypes.length === 0 ? (
        <div className="conn-empty">
          <h2>Este cérebro ainda não possui estrutura.</h2>
          <p>Crie seu primeiro tipo de conteúdo. Cada tipo vira um board na monday e depois você define como eles se conectam.</p>
          <button type="button" className="btn btn-primary" disabled={!canEdit} title={editHint} onClick={() => (registered ? setDialog('type') : setDialog('init'))}>
            <Plus size={16} aria-hidden="true" /> Criar primeiro tipo de conteúdo
          </button>
        </div>
      ) : (
        <div className="conn-body">
          <div className="conn-canvas" onClick={() => setSelection(null)}>
            <div className="conn-stage" style={{ width: STAGE_W, height }}>
              <svg className="conn-svg" width={STAGE_W} height={height}>
                <defs>
                  {(['hierarchy', 'association'] as const).map((kind) => (
                    <marker key={kind} id={`conn-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0 1 L10 5 L0 9 z" className={`conn-arrow is-${kind}`} />
                    </marker>
                  ))}
                </defs>
                {connections.map((c) => {
                  const g = geometry(c)
                  if (!g) return null
                  return (
                    <g key={c.id}>
                      <path d={g.path} className={`conn-line is-${c.kind} ${related(c) ? '' : 'is-dim'}`} markerEnd={`url(#conn-arrow-${c.kind})`} />
                      <path
                        d={g.path}
                        className="conn-hit"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelection({ kind: 'connection', id: c.id })
                        }}
                      />
                    </g>
                  )
                })}
              </svg>

              {connections.map((c) => {
                const g = geometry(c)
                if (!g) return null
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`conn-chip is-${c.kind} ${related(c) ? '' : 'is-dim'} ${selectedConn?.id === c.id ? 'is-selected' : ''}`}
                    style={{ left: g.mx, top: g.my }}
                    aria-label={`Conexão: ${c.name ?? c.label}`}
                    aria-pressed={selectedConn?.id === c.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelection({ kind: 'connection', id: c.id })
                    }}
                  >
                    {c.label}
                  </button>
                )
              })}

              {[...placed.values()].map(({ type, x, y }) => {
                const Icon = type.Icon
                const active = selection?.kind === 'type' && selection.id === type.id
                const dim = (selectedType && selectedType.id !== type.id && !connections.some((c) => related(c) && (c.from === type.id || c.to === type.id))) || (selectedConn && selectedConn.from !== type.id && selectedConn.to !== type.id)
                return (
                  <button
                    key={type.id}
                    type="button"
                    className={`type-card ${active ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}`}
                    style={{ left: x - CARD_W / 2, top: y, width: CARD_W, height: CARD_H, ['--accent' as string]: type.accent }}
                    aria-pressed={active}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelection(active ? null : { kind: 'type', id: type.id })
                    }}
                  >
                    <span className="type-card-icon">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <span className="type-card-name">{type.label}</span>
                    <span className="type-card-count">
                      {counts[type.id] ?? 0} {(counts[type.id] ?? 0) === 1 ? 'item' : 'itens'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <aside className="conn-panel" aria-label="Detalhes">
            {selectedType ? (
              <TypeDetails brain={brain} type={selectedType} count={counts[selectedType.id] ?? 0} baseUrl={schema?.baseUrl ?? ''} />
            ) : selectedConn ? (
              <ConnectionDetails brain={brain} conn={selectedConn} baseUrl={schema?.baseUrl ?? ''} />
            ) : (
              <Overview brain={brain} />
            )}
          </aside>
        </div>
      )}

      <footer className="conn-foot">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canEdit}
          title={editHint}
          onClick={() => (registered ? setDialog('type') : setDialog('init'))}
        >
          <Plus size={15} aria-hidden="true" /> Tipo de conteúdo
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canEdit || !registered || nodeTypes.length === 0}
          title={!registered ? 'Registre a estrutura primeiro.' : nodeTypes.length === 0 ? 'Crie um tipo de conteúdo primeiro.' : editHint}
          onClick={openConnectionDialog}
        >
          <Plus size={15} aria-hidden="true" /> Tipo de conexão
        </button>
        {!canEdit && <span className="conn-soon">Alterações estruturais desabilitadas neste ambiente.</span>}
      </footer>

      {dialog === 'type' && (
        <NodeTypeDialog
          brain={brain}
          onClose={() => setDialog(null)}
          onCreated={async (name) => {
            setDialog(null)
            await onChanged(`Tipo "${name}" criado na monday.`)
          }}
        />
      )}
      {dialog === 'connection' && (
        <ConnectionDialog
          brain={brain}
          initial={connectionInitial}
          onClose={() => setDialog(null)}
          onCreated={async (label) => {
            setDialog(null)
            await onChanged(`Conexão "${label}" criada na monday.`)
          }}
        />
      )}
      {dialog === 'init' && schema && (
        <InitDialog
          schema={schema}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await onChanged('Estrutura registrada na monday.')
          }}
        />
      )}
    </section>
  )
}

function KindChip({ kind }: { kind: BrainConnection['kind'] }) {
  return <span className={`kind-chip is-${kind}`}>{kind === 'hierarchy' ? 'Hierarquia' : 'Associação'}</span>
}

function Overview({ brain }: { brain: BrainConfig }) {
  return (
    <div className="conn-detail">
      <h3>Conexões permitidas</h3>
      <p className="conn-hint">Selecione um tipo ou uma conexão para ver os detalhes.</p>
      <ul className="conn-rules">
        {brain.connections.map((c) => {
          const from = brain.nodeTypes.find((t) => t.id === c.from)
          const to = brain.nodeTypes.find((t) => t.id === c.to)
          return (
            <li key={c.id}>
              <span className="conn-rule-line">
                {from?.label} <em>{c.label}</em> {to?.label}
              </span>
              <KindChip kind={c.kind} />
              <span className="conn-rule-desc">{c.description}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const boardUrl = (baseUrl: string, boardId?: string) => (baseUrl && boardId ? `${baseUrl}/boards/${boardId}` : '')

function TypeDetails({ brain, type, count, baseUrl }: { brain: BrainConfig; type: BrainNodeType; count: number; baseUrl: string }) {
  const Icon = type.Icon
  const rules = brain.connections.filter((c) => c.from === type.id || c.to === type.id)
  const url = boardUrl(baseUrl, type.boardId)
  return (
    <div className="conn-detail" style={{ ['--accent' as string]: type.accent }}>
      <div className="conn-detail-head">
        <span className="type-card-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <h3>{type.label}</h3>
      </div>
      <p className="conn-desc">{type.description}</p>
      <dl className="conn-facts">
        <div>
          <dt>Itens</dt>
          <dd>{count}</dd>
        </div>
        <div>
          <dt>Cérebro</dt>
          <dd>{brain.name}</dd>
        </div>
        <div>
          <dt>Papel</dt>
          <dd>{type.role === 'core' ? 'Núcleo (não pode ser removido)' : type.role === 'custom' ? 'Personalizado' : '—'}</dd>
        </div>
        <div>
          <dt>Board</dt>
          <dd>{type.boardName ?? type.origin}</dd>
        </div>
        <div>
          <dt>Identidade</dt>
          <dd>
            <span className="conn-swatch" style={{ background: type.accent }} aria-hidden="true" />
            {type.accent}
          </dd>
        </div>
      </dl>
      {url && (
        <a className="btn btn-ghost conn-open" href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} aria-hidden="true" /> Abrir board na monday
        </a>
      )}
      <h4>Conexões permitidas</h4>
      <ul className="conn-rules">
        {rules.length === 0 && <li className="conn-rule-desc">Nenhuma conexão configurada para este tipo.</li>}
        {rules.map((c) => {
          const out = c.from === type.id
          const other = brain.nodeTypes.find((t) => t.id === (out ? c.to : c.from))
          return (
            <li key={c.id}>
              <span className="conn-rule-line">
                {type.label} <em>{out ? c.label : c.reverseLabel}</em> {other?.label}
              </span>
              <KindChip kind={c.kind} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ConnectionDetails({ brain, conn, baseUrl }: { brain: BrainConfig; conn: BrainConnection; baseUrl: string }) {
  const from = brain.nodeTypes.find((t) => t.id === conn.from)
  const to = brain.nodeTypes.find((t) => t.id === conn.to)
  const holder = conn.storedOn === 'target' ? to : from
  const url = boardUrl(baseUrl, holder?.boardId)
  return (
    <div className="conn-detail">
      <h3>
        {from?.label} {conn.label} {to?.label}
      </h3>
      <KindChip kind={conn.kind} />
      <p className="conn-desc">{conn.description}</p>
      <dl className="conn-facts">
        <div>
          <dt>Origem</dt>
          <dd>{from?.label}</dd>
        </div>
        <div>
          <dt>Destino</dt>
          <dd>{to?.label}</dd>
        </div>
        <div>
          <dt>Natureza</dt>
          <dd>{conn.kind === 'hierarchy' ? 'Hierarquia' : 'Associação'}</dd>
        </div>
        <div>
          <dt>Cardinalidade</dt>
          <dd>{conn.cardinality ? CARDINALITY[conn.cardinality] : '—'}</dd>
        </div>
        <div>
          <dt>Board de origem</dt>
          <dd>{from?.boardName ?? '—'}</dd>
        </div>
        <div>
          <dt>Board de destino</dt>
          <dd>{to?.boardName ?? '—'}</dd>
        </div>
        <div>
          <dt>Coluna</dt>
          <dd>
            <code>{conn.columnId ?? '—'}</code> (no board {conn.storedOn === 'target' ? 'de destino' : 'de origem'})
          </dd>
        </div>
        <div>
          <dt>Coluna refletida</dt>
          <dd>
            <code>{conn.reflectionColumnId ?? 'nenhuma'}</code>
          </dd>
        </div>
      </dl>
      {url && (
        <a className="btn btn-ghost conn-open" href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} aria-hidden="true" /> Abrir board da coluna
        </a>
      )}
      <p className="conn-hint">Esta regra é só de consulta: colunas não são alteradas nem apagadas automaticamente.</p>
    </div>
  )
}
