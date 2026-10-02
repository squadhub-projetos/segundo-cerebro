import { useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Link2, X } from 'lucide-react'
import type { Content, ContentStatus, ContentType, Relation } from '../types'
import { THEMES } from '../lib/mock'
import { RELATION_RULES, isCompatible, linkOptionsFor, newId } from '../lib/relations'
import type { LinkDraft, SaveResult } from '../state/useStore'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'
import { IS_LIVE } from '../data/source'
import { CONTENT_STATUSES, SELECTABLE_TYPES, STATUS_META, TYPE_META } from './meta'

interface Props {
  /** Conteúdo em edição; null para criar. */
  existing: Content | null
  contents: Content[]
  relations: Relation[]
  onCancel: () => void
  onSave: (content: Content, links: LinkDraft[]) => Promise<SaveResult>
}

const sameLink = (a: LinkDraft, b: LinkDraft) => a.source === b.source && a.target === b.target && a.type === b.type

export function ContentForm({ existing, contents, relations, onCancel, onSave }: Props) {
  const uid = useId()
  const [id] = useState(() => existing?.id ?? newId('conteudo'))
  const [title, setTitle] = useState(existing?.title ?? '')
  const [type, setType] = useState<ContentType>(existing?.type ?? (SELECTABLE_TYPES.includes('aula') ? 'aula' : SELECTABLE_TYPES[0]))
  const [description, setDescription] = useState(existing?.description ?? '')
  const [body, setBody] = useState(existing?.bodyMarkdown ?? '')
  const [themes, setThemes] = useState<string[]>(existing?.themes ?? [])
  const [status, setStatus] = useState<ContentStatus>(existing?.status ?? 'em-producao')
  const [links, setLinks] = useState<LinkDraft[]>(() =>
    existing
      ? relations
          .filter((r) => r.source === existing.id || r.target === existing.id)
          .map(({ source, target, type: t }) => ({ source, target, type: t }))
      : [],
  )
  const [titleError, setTitleError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [saving, setSaving] = useState(false)

  const byId = useMemo(() => new Map(contents.map((c) => [c.id, c])), [contents])
  const typeOf = (contentId: string): ContentType | undefined => (contentId === id ? type : byId.get(contentId)?.type)

  const incompatible = links.filter((l) => {
    const s = typeOf(l.source)
    const t = typeOf(l.target)
    return !s || !t || !isCompatible(l.type, s, t)
  })

  const options = linkOptionsFor(type)
  const optionGroups = options
    .map((opt) => ({
      opt,
      candidates: contents.filter((c) => {
        if (c.id === id || c.type !== opt.otherType) return false
        const draft: LinkDraft =
          opt.role === 'source'
            ? { source: id, target: c.id, type: opt.relationType }
            : { source: c.id, target: id, type: opt.relationType }
        return !links.some((l) => sameLink(l, draft))
      }),
    }))
    .filter((g) => g.candidates.length > 0)

  const addLink = (value: string) => {
    if (!value) return
    const [relationType, role, otherId] = value.split('|') as [LinkDraft['type'], 'source' | 'target', string]
    const draft: LinkDraft =
      role === 'source' ? { source: id, target: otherId, type: relationType } : { source: otherId, target: id, type: relationType }
    setLinks((prev) => (prev.some((l) => sameLink(l, draft)) ? prev : [...prev, draft]))
    setFormError(null)
  }

  const persist = async () => {
    const valid = links.filter((l) => !incompatible.includes(l))
    const now: Content = {
      id,
      title: title.trim(),
      type,
      description: description.trim(),
      bodyMarkdown: body,
      themes,
      status,
      collectionId: existing?.collectionId ?? null,
      thumbnailPath: existing?.thumbnailPath ?? null,
      isMock: existing?.isMock ?? false,
    }
    setSaving(true)
    setFormError(null)
    const result = await onSave(now, valid)
    setSaving(false)
    if (!result.ok) {
      setConfirmRemoval(false)
      setFormError(result.error)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setTitleError('Informe um título.')
      document.getElementById(`${uid}-titulo`)?.focus()
      return
    }
    if (saving) return
    if (incompatible.length > 0) {
      setConfirmRemoval(true)
      return
    }
    void persist()
  }

  const describeLink = (l: LinkDraft) => {
    const rule = RELATION_RULES[l.type]
    const mine = l.source === id
    const other = byId.get(mine ? l.target : l.source)
    return { label: mine ? rule.outLabel : rule.inLabel, other: other?.title ?? 'Conteúdo removido' }
  }

  const formId = `${uid}-form`

  return (
    <>
      <Modal
        title={existing ? 'Editar conteúdo' : 'Novo conteúdo'}
        onClose={onCancel}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={saving}>
              {saving ? (IS_LIVE ? 'Salvando na monday…' : 'Salvando…') : existing ? 'Salvar alterações' : 'Criar conteúdo'}
            </button>
          </>
        }
      >
        <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-titulo`}>
              Título <span className="required">(obrigatório)</span>
            </label>
            <input
              id={`${uid}-titulo`}
              data-autofocus
              value={title}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? `${uid}-titulo-erro` : undefined}
              onChange={(e) => {
                setTitle(e.target.value)
                if (titleError) setTitleError(null)
              }}
            />
            {titleError && (
              <p id={`${uid}-titulo-erro`} className="field-error" role="alert">
                {titleError}
              </p>
            )}
          </div>

          <div className="field-row">
            <div className="field" role="radiogroup" aria-labelledby={`${uid}-tipo`}>
              <span id={`${uid}-tipo`} className="field-label">
                Tipo
              </span>
              <div className="seg">
                {SELECTABLE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={type === t}
                    className="seg-btn"
                    disabled={IS_LIVE && !!existing && t !== type}
                    onClick={() => setType(t)}
                  >
                    {TYPE_META[t].label}
                  </button>
                ))}
              </div>
            </div>
            {!IS_LIVE && (
              <div className="field" role="radiogroup" aria-labelledby={`${uid}-status`}>
                <span id={`${uid}-status`} className="field-label">
                  Status
                </span>
                <div className="seg">
                  {CONTENT_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="radio"
                      aria-checked={status === st}
                      className="seg-btn"
                      onClick={() => setStatus(st)}
                    >
                      {STATUS_META[st].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(!IS_LIVE || type === 'aula') && (
          <div className="field">
            <label htmlFor={`${uid}-descricao`}>Descrição</label>
            <textarea id={`${uid}-descricao`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          )}

          {!IS_LIVE && (
            <>
          <div className="field">
            <label htmlFor={`${uid}-texto`}>Texto completo</label>
            <textarea
              id={`${uid}-texto`}
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-describedby={`${uid}-texto-ajuda`}
            />
            <p id={`${uid}-texto-ajuda`} className="field-hint">
              Aceita Markdown simples: títulos com ##, listas e negrito.
            </p>
          </div>

          <fieldset className="field">
            <legend>Temas</legend>
            <div className="chip-row">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="chip"
                  aria-pressed={themes.includes(theme.id)}
                  onClick={() =>
                    setThemes((prev) => (prev.includes(theme.id) ? prev.filter((t) => t !== theme.id) : [...prev, theme.id]))
                  }
                >
                  {theme.label}
                </button>
              ))}
            </div>
          </fieldset>
            </>
          )}

          <details className="links-advanced">
            <summary>
              Vínculos (gerenciamento alternativo){links.length > 0 ? ` · ${links.length}` : ''}
            </summary>
            <p className="field-hint">A forma principal de conectar conteúdos é arrastar de um card a outro no mapa.</p>
            {links.length > 0 && (
              <ul className="link-list">
                {links.map((l) => {
                  const { label, other } = describeLink(l)
                  const bad = incompatible.includes(l)
                  return (
                    <li key={`${l.source}-${l.target}-${l.type}`} className={bad ? 'link-bad' : ''}>
                      <Link2 size={14} aria-hidden="true" />
                      <span>
                        {label}: <strong>{other}</strong>
                        {bad && <em> (incompatível com o tipo escolhido)</em>}
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remover vínculo: ${label} ${other}`}
                        onClick={() => setLinks((prev) => prev.filter((x) => x !== l))}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <label htmlFor={`${uid}-vinculo`} className="sub-label">
              Adicionar vínculo (opcional)
            </label>
            <select id={`${uid}-vinculo`} value="" onChange={(e) => addLink(e.target.value)}>
              <option value="">{optionGroups.length ? 'Selecione um conteúdo' : 'Nenhum vínculo disponível'}</option>
              {optionGroups.map(({ opt, candidates }) => (
                <optgroup key={`${opt.relationType}-${opt.role}`} label={opt.label}>
                  {candidates.map((c) => (
                    <option key={c.id} value={`${opt.relationType}|${opt.role}|${c.id}`}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </details>

          {incompatible.length > 0 && (
            <p className="form-warning" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              {incompatible.length === 1 ? 'Um vínculo não é' : `${incompatible.length} vínculos não são`} compatível com o tipo
              escolhido e será removido ao salvar, com confirmação.
            </p>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </Modal>

      {confirmRemoval && (
        <ConfirmDialog
          title="Remover vínculos incompatíveis?"
          confirmLabel="Remover e salvar"
          onCancel={() => setConfirmRemoval(false)}
          onConfirm={() => void persist()}
        >
          <p>A mudança de tipo torna estes vínculos incompatíveis. Eles serão removidos:</p>
          <ul className="confirm-list">
            {incompatible.map((l) => {
              const { label, other } = describeLink(l)
              return (
                <li key={`${l.source}-${l.target}-${l.type}`}>
                  {label}: <strong>{other}</strong>
                </li>
              )
            })}
          </ul>
        </ConfirmDialog>
      )}
    </>
  )
}
