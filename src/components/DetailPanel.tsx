import { useMemo } from 'react'
import Markdown from 'react-markdown'
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Eye, Pencil, Trash2, X } from 'lucide-react'
import type { Content, Relation } from '../types'
import { RELATION_RULES, RELATION_TYPES } from '../lib/relations'
import { THEMES } from '../lib/mock'
import { Thumbnail } from './Thumbnail'
import { STATUS_META, TYPE_META, collectionColor, collectionName, hexToRgba } from './meta'

interface Props {
  content: Content
  contents: Content[]
  relations: Relation[]
  visibleIds: Set<string>
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onGoTo: (id: string) => void
  onReveal: (id: string) => void
  /** Conteúdo vindo da monday: sem editar nem excluir (somente leitura). */
  readOnly?: boolean
  /** Em saída: toca a animação de fechamento e ignora cliques. */
  closing?: boolean
}

interface RelatedGroup {
  label: string
  direction: 'out' | 'in'
  items: Content[]
  /** IDs ligados por relação inferida (temporária), não explícita na monday. */
  inferred: Set<string>
}

function buildGroups(content: Content, contents: Content[], relations: Relation[]): RelatedGroup[] {
  const byId = new Map(contents.map((c) => [c.id, c]))
  const groups: RelatedGroup[] = []
  for (const type of RELATION_TYPES) {
    const rule = RELATION_RULES[type]
    const incoming = relations.filter((r) => r.type === type && r.target === content.id)
    const outgoing = relations.filter((r) => r.type === type && r.source === content.id)
    const collect = (list: Relation[], key: 'source' | 'target') =>
      list.map((r) => byId.get(r[key])).filter((c): c is Content => Boolean(c))
    const inferredOf = (list: Relation[], key: 'source' | 'target') => new Set(list.filter((r) => r.relationSource === 'inferred').map((r) => r[key]))
    if (incoming.length) groups.push({ label: rule.inLabel, direction: 'in', items: collect(incoming, 'source'), inferred: inferredOf(incoming, 'source') })
    if (outgoing.length) groups.push({ label: rule.outLabel, direction: 'out', items: collect(outgoing, 'target'), inferred: inferredOf(outgoing, 'target') })
  }
  return groups
}

export function DetailPanel({ content, contents, relations, visibleIds, onClose, onEdit, onDelete, onGoTo, onReveal, readOnly = false, closing = false }: Props) {
  const groups = useMemo(() => buildGroups(content, contents, relations), [content, contents, relations])
  const { Icon, label } = TYPE_META[content.type]
  const themeLabels = content.themes.map((id) => THEMES.find((t) => t.id === id)?.label ?? id)

  return (
    <aside
      className={`detail ${closing ? 'is-closing' : ''}`}
      aria-label={`Detalhes: ${content.title}`}
      aria-hidden={closing || undefined}
      style={{ '--set-color': collectionColor(content.collectionId) } as React.CSSProperties}
    >
      <div className="detail-scroll" key={content.id}>
        <Thumbnail content={content} className="detail-cover" />
        <div className="detail-head">
          <div className="detail-badges">
            <span className="badge-type">
              <Icon size={13} aria-hidden="true" />
              {label}
            </span>
            <span className="badge-status">
              <span className={`status-dot status-${content.status}`} aria-hidden="true" />
              {STATUS_META[content.status].label}
            </span>
          </div>
          <h2>{content.title}</h2>
          <p className="detail-collection">{collectionName(content.collectionId)}</p>
          {content.description && <p className="detail-description">{content.description}</p>}
          {themeLabels.length > 0 && (
            <ul className="theme-list" aria-label="Temas">
              {themeLabels.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>

        {content.metadata && content.metadata.length > 0 && (
          <dl className="detail-meta" aria-label="Informações">
            {content.metadata.map((m, i) => (
              <div key={`${m.label}-${i}`}>
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className="detail-origin">
          Origem: {content.source === 'monday' ? 'monday.com' : content.source === 'mock' ? 'demonstração' : 'local'}
          {content.source === 'monday' && content.sourceUrl && (
            <>
              {' · '}
              <a href={content.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} aria-hidden="true" /> Abrir na monday
              </a>
            </>
          )}
        </p>

        {content.bodyMarkdown.trim() && (
          <div className="markdown">
            <Markdown components={{ h1: 'h3', h2: 'h3', h3: 'h4' }}>{content.bodyMarkdown}</Markdown>
          </div>
        )}

        <section className="related" aria-label="Conteúdos relacionados">
          <h3>Relacionados</h3>
          {groups.length === 0 && <p className="muted">Este conteúdo ainda não tem vínculos.</p>}
          {groups.map((group) => (
            <div key={`${group.direction}-${group.label}`} className="related-group">
              <h4>
                {group.direction === 'out' ? (
                  <ArrowUpRight size={13} aria-hidden="true" />
                ) : (
                  <ArrowDownLeft size={13} aria-hidden="true" />
                )}
                {group.label}
              </h4>
              <ul>
                {group.items.map((item, index) => {
                  const visible = visibleIds.has(item.id)
                  return (
                    <li key={item.id} className="related-item" style={{ '--i': index } as React.CSSProperties}>
                      <button
                        type="button"
                        className="related-link"
                        onClick={() => onGoTo(item.id)}
                        disabled={!visible}
                        aria-label={`${TYPE_META[item.type].label}: ${item.title}`}
                      >
                        <span
                          className="related-tile"
                          style={{ '--tile-color': collectionColor(item.collectionId), '--tile-tint': hexToRgba(collectionColor(item.collectionId), 0.14) } as React.CSSProperties}
                        >
                          {(() => {
                            const ItemIcon = TYPE_META[item.type].Icon
                            return <ItemIcon size={17} aria-hidden="true" />
                          })()}
                        </span>
                        <span className="related-text">
                          <span className="related-title">{item.title}</span>
                          <span className="related-sub">
                            {TYPE_META[item.type].label}
                            {group.inferred.has(item.id) && ' · relação inferida'}
                            {!visible && ' · oculto pelos filtros'}
                          </span>
                        </span>
                      </button>
                      {!visible && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReveal(item.id)}>
                          <Eye size={14} aria-hidden="true" />
                          Revelar
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      </div>

      <div className="detail-actions">
        {!readOnly && (
          <button type="button" className="btn btn-primary" onClick={onEdit}>
            <Pencil size={15} aria-hidden="true" />
            Editar
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          <X size={15} aria-hidden="true" />
          Fechar
        </button>
        {!readOnly && (
          <button type="button" className="btn btn-quiet btn-delete" onClick={onDelete}>
            <Trash2 size={14} aria-hidden="true" />
            Excluir conteúdo
          </button>
        )}
      </div>
    </aside>
  )
}
