/**
 * Plano de ações proposto pela IA. É DADOS puros (nada executável): o navegador o exibe e, só depois da confirmação humana,
 * o devolve ao servidor, que o valida de novo, ação por ação, antes de executar qualquer coisa.
 */

/** Ponta de uma conexão: um conteúdo que já existe (`id`) ou um conteúdo novo do próprio plano (`ref`). */
export type Endpoint = { ref: string } | { id: string }

export interface PlanCreate {
  kind: 'create'
  /** Nome interno ("novo-1") usado pelas conexões do plano. */
  ref: string
  type: string
  title: string
  description?: string
}

export interface PlanConnect {
  kind: 'connect'
  connection: string
  source: Endpoint
  target: Endpoint
}

export type PlanAction = PlanCreate | PlanConnect

export interface ActionPlan {
  brainId: string
  actions: PlanAction[]
  warnings: string[]
}

/** Resumo legível do plano (sem ids, slugs ou termos técnicos): é o que o usuário vê no cartão de proposta. */
export interface PlanView {
  creates: { typeLabel: string; typePlural: string; count: number }[]
  reuses: number
  connections: number
  lines: { kind: 'create' | 'reuse' | 'connect'; text: string }[]
}

export interface ProposedPlan extends ActionPlan {
  view: PlanView
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  message: string
  plan: ProposedPlan | null
}

export interface ActionResult {
  index: number
  kind: PlanAction['kind']
  status: 'ok' | 'failed' | 'skipped'
  /** Texto em linguagem simples. */
  message: string
  contentId?: string
}

export interface ExecuteResponse {
  ok: boolean
  results: ActionResult[]
  createdIds: string[]
  reusedIds: string[]
  message: string
}

