import { useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { BRAINS } from '../../brains/registry'
import type { BrainConfig } from '../../brains/types'
import { ICONS } from '../../lib/icons'
import { pluralize } from '../../lib/plural'
import type { Cardinality, ConnectionNature, SchemaPayload } from '../../types/schema'
import { StructureError } from '../../data/providers/errors'
import { adminKey, schemaApi } from '../../data/providers/schemaApi'
import type { ConnectionInput, ConnectionPlan, NodeTypeInput, NodeTypePlan } from '../../data/providers/schemaApi'
import { Modal } from '../Modal'

/**
 * Diálogos de alteração do schema. Fluxo comum: formulário → pré-visualização do que será criado na monday → criação.
 * Nada é criado antes da confirmação e nada aparece no app antes de a monday confirmar. Se a criação falhar no meio, o
 * diálogo mostra o que já foi feito e oferece "Tentar concluir configuração" (a operação é idempotente no servidor).
 */

type Step = 'form' | 'preview'

interface FlowState {
  step: Step
  busy: boolean
  error: string | null
  partial: StructureError['details'] | null
  needKey: boolean
}

/** Estado e execução compartilhados pelos diálogos (erros HTTP, chave de administração, falha parcial). */
function useFlow(onDone: () => Promise<void> | void) {
  const [state, setState] = useState<FlowState>({ step: 'form', busy: false, error: null, partial: null, needKey: false })
  const retry = useRef<(() => Promise<void>) | null>(null)

  const patch = (p: Partial<FlowState>) => setState((s) => ({ ...s, ...p }))

  /** Executa `fn`; em caso de erro volta para a etapa `failStep` mostrando a causa real (HTTP, chave, falha parcial). */
  const run = async (failStep: Step, fn: () => Promise<void>) => {
    retry.current = () => run(failStep, fn)
    patch({ busy: true, error: null, partial: null, needKey: false })
    try {
      await fn()
      patch({ busy: false })
    } catch (error) {
      const e = error as StructureError
      if (e.code === 'admin_key_required' || e.code === 'admin_key_invalid') {
        patch({ busy: false, step: failStep, needKey: true, error: e.code === 'admin_key_invalid' ? 'Chave de administração inválida.' : null })
        return
      }
      patch({ busy: false, step: failStep, error: e.message ?? 'Erro desconhecido.', partial: e.code === 'partial' ? (e.details ?? null) : null })
    }
  }

  const finish = async () => {
    await onDone()
  }

  const submitKey = (value: string) => {
    adminKey.set(value.trim())
    patch({ needKey: false, error: null })
    void retry.current?.()
  }

  return { state, patch, run, finish, submitKey }
}

function Feedback({ state, onKey, onRetryPartial }: { state: FlowState; onKey: (v: string) => void; onRetryPartial: () => void }) {
  const [key, setKey] = useState('')
  const id = useId()
  return (
    <>
      {state.needKey && (
        <div className="field">
          <label htmlFor={`${id}-key`}>Chave de administração</label>
          <div className="key-row">
            <input id={`${id}-key`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={!key.trim()} onClick={() => onKey(key)}>
              Confirmar
            </button>
          </div>
          <p className="field-hint">Alterar a estrutura exige a chave configurada no servidor. Ela fica apenas nesta sessão do navegador.</p>
        </div>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" /> {state.error}
        </p>
      )}
      {state.partial && (
        <div className="form-warning" role="status">
          <span>
            Etapas concluídas: {state.partial.completed.length ? state.partial.completed.join(', ') : 'nenhuma'}. Falhou em: {state.partial.failedStep}.
            {state.partial.boardName ? ` Board: ${state.partial.boardName}.` : ''} Nada foi apagado.
          </span>
          <button type="button" className="btn btn-ghost" onClick={onRetryPartial}>
            Tentar concluir configuração
          </button>
        </div>
      )}
    </>
  )
}

function Footer({ state, canContinue, submitLabel, onCancel, onBack, onConfirm }: { state: FlowState; canContinue: boolean; submitLabel: string; onCancel: () => void; onBack: () => void; onConfirm: () => void }) {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={state.step === 'preview' ? onBack : onCancel} disabled={state.busy}>
        {state.step === 'preview' ? 'Voltar' : 'Cancelar'}
      </button>
      {state.step === 'preview' ? (
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={state.busy}>
          {state.busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
          {state.busy ? 'Criando na monday…' : submitLabel}
        </button>
      ) : (
        <button type="submit" form="structure-form" className="btn btn-primary" disabled={!canContinue || state.busy}>
          {state.busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
          {state.busy ? 'Verificando…' : 'Continuar'}
        </button>
      )}
    </>
  )
}

function PreviewList({ title, rows }: { title: string; rows: { label: string; value: ReactNode }[] }) {
  return (
    <div className="plan">
      <p className="plan-title">{title}</p>
      <dl className="conn-facts">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/* ------------------------------------------------------------------ novo tipo de conteúdo */

export function NodeTypeDialog({ brain, onClose, onCreated }: { brain: BrainConfig; onClose: () => void; onCreated: (name: string) => Promise<void> | void }) {
  const uid = useId()
  const [name, setName] = useState('')
  const [plural, setPlural] = useState('')
  const [pluralEdited, setPluralEdited] = useState(false)
  const [description, setDescription] = useState('')
  // O cérebro padrão é o atual (pode ser trocado no diálogo).
  const [brainId, setBrainId] = useState(brain.id)
  const [icon, setIcon] = useState('box')
  const [plan, setPlan] = useState<NodeTypePlan | null>(null)
  const flow = useFlow(async () => {
    await onCreated(name.trim())
  })
  const { state } = flow
  const input: NodeTypeInput = { name, plural: plural.trim() || name, description, brainId, icon }
  const brainName = BRAINS.find((b) => b.id === brainId)?.name ?? brainId

  const preview = (e: FormEvent) => {
    e.preventDefault()
    void flow.run('form', async () => {
      const p = await schemaApi.previewNodeType(input)
      setPlan(p)
      flow.patch({ step: 'preview' })
    })
  }
  const create = () =>
    flow.run('preview', async () => {
      await schemaApi.createNodeType(input)
      await flow.finish()
    })

  return (
    <Modal
      title="Novo tipo de conteúdo"
      onClose={state.busy ? () => undefined : onClose}
      footer={<Footer state={state} canContinue={name.trim().length >= 2} submitLabel="Criar tipo" onCancel={onClose} onBack={() => flow.patch({ step: 'form', partial: null, error: null })} onConfirm={() => void create()} />}
    >
      {state.step !== 'preview' ? (
        <form id="structure-form" className="form" onSubmit={preview} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-nome`}>Nome (singular)</label>
            <input
              id={`${uid}-nome`}
              data-autofocus
              value={name}
              maxLength={60}
              onChange={(e) => {
                setName(e.target.value)
                if (!pluralEdited) setPlural(pluralize(e.target.value))
              }}
              placeholder="Por exemplo: Isca"
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-plural`}>Nome no plural</label>
            <input
              id={`${uid}-plural`}
              value={plural}
              maxLength={60}
              onChange={(e) => {
                setPlural(e.target.value)
                setPluralEdited(true)
              }}
            />
            <p className="field-hint">
              Board na monday: SC | {brainName} | {plural.trim() || name.trim() || '…'}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-desc`}>Descrição</label>
            <textarea id={`${uid}-desc`} rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${uid}-brain`}>Cérebro</label>
              <select id={`${uid}-brain`} value={brainId} onChange={(e) => setBrainId(e.target.value)}>
                {BRAINS.filter((b) => b.enabled).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" role="radiogroup" aria-labelledby={`${uid}-store`}>
              <span id={`${uid}-store`} className="field-label">
                Armazenamento
              </span>
              <div className="seg">
                <button type="button" role="radio" aria-checked className="seg-btn">
                  Criar novo board
                </button>
                <button type="button" role="radio" aria-checked={false} className="seg-btn" disabled title="Em breve">
                  Usar board existente
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Ícone</span>
            <div className="icon-grid" role="radiogroup" aria-label="Ícone">
              {Object.entries(ICONS).map(([key, { label, Icon }]) => (
                <button key={key} type="button" role="radio" aria-checked={icon === key} aria-label={label} title={label} className="icon-choice" onClick={() => setIcon(key)}>
                  <Icon size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <Feedback state={state} onKey={flow.submitKey} onRetryPartial={() => void create()} />
        </form>
      ) : (
        <div className="form">
          <PreviewList
            title="Será criado na monday"
            rows={[
              { label: 'Cérebro', value: plan?.brainName },
              { label: 'Board', value: plan?.boardName },
              { label: 'Workspace', value: plan?.workspace?.name ?? '—' },
              { label: 'Pasta', value: plan?.folder?.name ?? '—' },
              { label: 'Colunas', value: ['Nome', ...(plan?.columns ?? [])].join(', ') },
              { label: 'Ícone', value: ICONS[icon]?.label },
            ]}
          />
          {plan?.initializesRegistry && <p className="field-hint">Isto também cria os boards de estrutura "SC | Estrutura" e "SC | Relações" (primeira vez).</p>}
          <Feedback state={state} onKey={flow.submitKey} onRetryPartial={() => void create()} />
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ nova conexão */

const NATURES: { id: ConnectionNature; label: string }[] = [
  { id: 'hierarchy', label: 'Hierarquia' },
  { id: 'association', label: 'Associação' },
]
const CARDINALITIES: { id: Cardinality; label: string }[] = [
  { id: 'one-one', label: 'Um para um' },
  { id: 'one-many', label: 'Um para muitos' },
  { id: 'many-many', label: 'Muitos para muitos' },
]

export function ConnectionDialog({
  brain,
  initial,
  onClose,
  onCreated,
}: {
  brain: BrainConfig
  initial?: { source?: string; target?: string } | null
  onClose: () => void
  onCreated: (label: string) => Promise<void> | void
}) {
  const uid = useId()
  const types = brain.nodeTypes
  const [source, setSource] = useState(initial?.source ?? types[0]?.id ?? '')
  const [target, setTarget] = useState(initial?.target ?? types[1]?.id ?? types[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [reverse, setReverse] = useState('')
  const [nature, setNature] = useState<ConnectionNature>('association')
  const [cardinality, setCardinality] = useState<Cardinality>('many-many')
  const [plan, setPlan] = useState<ConnectionPlan | null>(null)
  const flow = useFlow(async () => {
    await onCreated(label.trim())
  })
  const { state } = flow
  const input: ConnectionInput = { brainId: brain.id, source, target, label, reverseLabel: reverse, nature, cardinality }
  const nameOf = (id: string) => types.find((t) => t.id === id)?.label ?? id

  const preview = (e: FormEvent) => {
    e.preventDefault()
    void flow.run('form', async () => {
      setPlan(await schemaApi.previewConnection(input))
      flow.patch({ step: 'preview' })
    })
  }
  const create = () =>
    flow.run('preview', async () => {
      await schemaApi.createConnection(input)
      await flow.finish()
    })

  return (
    <Modal
      title="Novo tipo de conexão"
      onClose={state.busy ? () => undefined : onClose}
      footer={<Footer state={state} canContinue={Boolean(source && target && label.trim().length >= 2)} submitLabel="Criar conexão" onCancel={onClose} onBack={() => flow.patch({ step: 'form', partial: null, error: null })} onConfirm={() => void create()} />}
    >
      {state.step !== 'preview' ? (
        <form id="structure-form" className="form" onSubmit={preview} noValidate>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${uid}-origem`}>Origem</label>
              <select id={`${uid}-origem`} data-autofocus value={source} onChange={(e) => setSource(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${uid}-destino`}>Destino</label>
              <select id={`${uid}-destino`} value={target} onChange={(e) => setTarget(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${uid}-rotulo`}>Nome da relação</label>
              <input id={`${uid}-rotulo`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="contém, direciona para..." />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-inverso`}>No sentido inverso (opcional)</label>
              <input id={`${uid}-inverso`} value={reverse} maxLength={40} onChange={(e) => setReverse(e.target.value)} placeholder="usada em, recebe de..." />
            </div>
          </div>
          <div className="field" role="radiogroup" aria-labelledby={`${uid}-nat`}>
            <span id={`${uid}-nat`} className="field-label">
              Natureza
            </span>
            <div className="seg">
              {NATURES.map((n) => (
                <button key={n.id} type="button" role="radio" aria-checked={nature === n.id} className="seg-btn" onClick={() => setNature(n.id)}>
                  {n.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field" role="radiogroup" aria-labelledby={`${uid}-card`}>
            <span id={`${uid}-card`} className="field-label">
              Cardinalidade
            </span>
            <div className="seg">
              {CARDINALITIES.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={cardinality === c.id} className="seg-btn" onClick={() => setCardinality(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <Feedback state={state} onKey={flow.submitKey} onRetryPartial={() => void create()} />
        </form>
      ) : (
        <div className="form">
          <PreviewList
            title="Será criada uma relação"
            rows={[
              { label: 'Relação', value: `${nameOf(source)} ${label.trim()} ${nameOf(target)}` },
              { label: 'Natureza', value: NATURES.find((n) => n.id === nature)?.label },
              { label: 'Cardinalidade', value: CARDINALITIES.find((c) => c.id === cardinality)?.label },
              { label: 'Coluna', value: `Connect Boards "${plan?.columnTitle}" no board "${plan?.boardName}"` },
              { label: 'Múltiplos itens', value: plan?.multiple ? 'Sim' : 'Não (um item por vez)' },
              { label: 'Reflexo', value: plan?.reflection ? 'Coluna refletida criada no board de destino' : 'Sem coluna refletida (mesmo board)' },
            ]}
          />
          <Feedback state={state} onKey={flow.submitKey} onRetryPartial={() => void create()} />
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ inicializar o registry */

export function InitDialog({ schema, onClose, onDone }: { schema: SchemaPayload; onClose: () => void; onDone: () => Promise<void> | void }) {
  const flow = useFlow(async () => {
    await onDone()
  })
  const { state } = flow
  const start = () =>
    flow.run('preview', async () => {
      await schemaApi.init()
      await flow.finish()
    })
  return (
    <Modal
      title="Registrar a estrutura na monday"
      onClose={state.busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={state.busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={state.busy}>
            {state.busy ? 'Criando…' : 'Registrar'}
          </button>
        </>
      }
    >
      <div className="form">
        <PreviewList
          title="Será criado na monday"
          rows={[
            { label: 'Boards', value: 'SC | Estrutura e SC | Relações' },
            { label: 'Workspace', value: schema.workspace?.name ?? '—' },
            { label: 'Pasta', value: schema.folder?.name ?? '—' },
            { label: 'Registro', value: 'Infoproduto, Aula e YouTube + as 2 conexões atuais (os boards existentes não são alterados)' },
          ]}
        />
        <Feedback state={state} onKey={flow.submitKey} onRetryPartial={() => void start()} />
      </div>
    </Modal>
  )
}
