import { memo } from 'react'
import type { ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { Content } from '../types'
import type { MatchInfo } from '../lib/search'
import { Highlight } from './Highlight'
import { Thumbnail } from './Thumbnail'
import { BRAND_CYAN, LAYOUT_KIND, STATUS_META, TYPE_ACCENT, TYPE_META, collectionColor, hexToRgba } from './meta'

/** Nível de detalhe do zoom semântico. */
export type DetailLevel = 'far' | 'mid' | 'near'
/** Papel do nó em relação ao foco atual (hover ou seleção). */
export type Emphasis = 'none' | 'related' | 'dim'
/** Presença: o nó participa dos resultados ('in') ou está saindo/ausente ('out'). */
export type Presence = 'in' | 'out'
/** Papel na busca de texto: 'off' sem busca; 'primary' casa no título; 'secondary' casa em tema/descrição; 'miss' não casa. */
export type QueryState = 'off' | 'primary' | 'secondary' | 'miss'

export type ContentNodeData = {
  content: Content
  level: DetailLevel
  selected: boolean
  hovered: boolean
  emphasis: Emphasis
  presence: Presence
  queryState: QueryState
  /** Pulso único: este nó acabou de receber uma conexão. */
  pulse: boolean
  /** Recém-criado: animação de entrada. */
  born: boolean
  /** Motivo da correspondência da busca atual. */
  search: MatchInfo | null
  /** Há busca ou filtro ativo: no zoom distante os resultados ganham título. */
  resultMode: boolean
} & Record<string, unknown>

export type ContentFlowNode = Node<ContentNodeData, 'content'>

const kindOf = (c: Content) => LAYOUT_KIND[c.type]

function Title({ content, info }: { content: Content; info: MatchInfo | null }) {
  return (
    <span className="title">
      <Highlight text={content.title} ranges={info?.titleRanges} />
    </span>
  )
}

function Reason({ info }: { info: MatchInfo | null }) {
  const extra = info?.extra
  if (!extra) return null
  return (
    <span className="reason">
      <span className="reason-k">{extra.kind === 'theme' ? 'Tema' : extra.kind === 'meta' ? extra.label : 'Descrição'}:</span>{' '}
      <Highlight text={extra.text} ranges={extra.ranges} />
    </span>
  )
}

function StatusLine({ content }: { content: Content }) {
  return (
    <span className="status-line">
      <span className={`status-dot status-${content.status}`} aria-hidden="true" />
      {STATUS_META[content.status].label}
    </span>
  )
}

function TypeLabel({ content }: { content: Content }) {
  const { Icon, label } = TYPE_META[content.type]
  return (
    <span className="type-label">
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  )
}

/** Linha inferior: o motivo da busca, quando existe; senão, tipo (e status). */
function Foot({ content, info, status }: { content: Content; info: MatchInfo | null; status?: boolean }) {
  if (info?.extra) return <Reason info={info} />
  return (
    <span className="meta-row">
      <TypeLabel content={content} />
      {status && <StatusLine content={content} />}
    </span>
  )
}

/** Zoom distante: forma e símbolo; texto só para os nós principais (ou resultados da busca). */
function FarLayer({ content, info, resultMode }: { content: Content; info: MatchInfo | null; resultMode: boolean }) {
  const { Icon } = TYPE_META[content.type]
  if (kindOf(content) === 'criativo') {
    return (
      <>
        <Thumbnail content={content} className="fill" />
        {resultMode ? (
          <div className="far-scrim">
            <span className="far-label">
              <Highlight text={content.title} ranges={info?.titleRanges} />
            </span>
          </div>
        ) : (
          <span className="far-badge">
            <Icon size={22} aria-hidden="true" />
          </span>
        )}
      </>
    )
  }
  if (kindOf(content) === 'aula') {
    return resultMode ? (
      <div className="far-main far-main-sm">
        <Icon size={20} aria-hidden="true" />
        <span className="far-label">
          <Highlight text={content.title} ranges={info?.titleRanges} />
        </span>
      </div>
    ) : (
      <Icon className="far-icon" size={30} aria-hidden="true" />
    )
  }
  return (
    <div className="far-main">
      <Icon size={kindOf(content) === 'curso' ? 34 : 26} aria-hidden="true" />
      <span className="far-title">
        <Highlight text={content.title} ranges={info?.titleRanges} />
      </span>
    </div>
  )
}

function MidLayer({ content, info }: { content: Content; info: MatchInfo | null }) {
  switch (kindOf(content)) {
    case 'curso':
      return (
        <>
          <Thumbnail content={content} className="strip" />
          <div className="body">
            <Title content={content} info={info} />
            <Foot content={content} info={info} />
          </div>
        </>
      )
    case 'criativo':
      return (
        <>
          <Thumbnail content={content} className="fill" />
          <div className="scrim">
            <Title content={content} info={info} />
            <Foot content={content} info={info} />
          </div>
        </>
      )
    default:
      return (
        <div className="body body-center">
          <Title content={content} info={info} />
          <Foot content={content} info={info} />
        </div>
      )
  }
}

function NearLayer({ content, info }: { content: Content; info: MatchInfo | null }) {
  const { Icon } = TYPE_META[content.type]
  const meta: ReactNode = <Foot content={content} info={info} status />
  switch (kindOf(content)) {
    case 'curso':
      return (
        <>
          <Thumbnail content={content} className="strip" />
          <div className="body">
            <Title content={content} info={info} />
            {!info?.extra && <span className="desc">{content.description}</span>}
            {meta}
          </div>
        </>
      )
    case 'criativo':
      return (
        <>
          <Thumbnail content={content} className="strip strip-tall" />
          <div className="body">
            <Title content={content} info={info} />
            {meta}
          </div>
        </>
      )
    case 'pagina':
      return (
        <div className="row row-stretch">
          <Thumbnail content={content} className="side" />
          <div className="body">
            <Title content={content} info={info} />
            {meta}
          </div>
        </div>
      )
    default:
      return (
        <div className="row">
          <span className="tile">
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="body">
            <Title content={content} info={info} />
            {meta}
          </div>
        </div>
      )
  }
}

function ContentNodeView({ data }: NodeProps<ContentFlowNode>) {
  const { content, level, selected, hovered, emphasis, presence, queryState, pulse, born, search, resultMode } = data
  const color = collectionColor(content.collectionId)
  const classes = ['node', `node-${kindOf(content)}`, `node-type-${content.type}`, `emphasis-${emphasis}`, `presence-${presence}`, `q-${queryState}`]
  if (selected) classes.push('is-selected')
  if (hovered) classes.push('is-hovered')
  if (pulse) classes.push('pulse')
  if (born) classes.push('born')

  return (
    <div
      className={classes.join(' ')}
      data-level={level}
      style={
        {
          '--node-color': BRAND_CYAN,
          '--node-glow': hexToRgba(BRAND_CYAN, 0.45),
          '--set-color': color,
          '--type-color': TYPE_ACCENT[content.type] ?? color,
          '--node-tint': hexToRgba(color, 0.13),
        } as React.CSSProperties
      }
    >
      {/* Pontos mínimos e invisíveis: o React Flow exige handles para ligar as arestas, que calculam a própria geometria.
          A conexão em si nasce do contorno do card (ver BoundaryConnect). */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="node-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="node-handle" />
      {pulse && <span className="node-ring" aria-hidden="true" />}
      <div className="node-inner">
        {/* Apenas a camada do nível atual existe no DOM: nunca há dois textos sobrepostos. */}
        <div className={`layer layer-${level}`} key={level}>
          {level === 'far' && <FarLayer content={content} info={search} resultMode={resultMode} />}
          {level === 'mid' && <MidLayer content={content} info={search} />}
          {level === 'near' && <NearLayer content={content} info={search} />}
        </div>
      </div>
    </div>
  )
}

export const ContentNode = memo(ContentNodeView)
