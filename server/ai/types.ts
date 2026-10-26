import type { Content, Relation } from '../../src/types/index.js'
import type { ConnectionDef, NodeTypeDef, SchemaPayload } from '../../src/types/schema.js'

export type {
  ActionPlan,
  ActionResult,
  ChatResponse,
  ChatTurn,
  Endpoint,
  ExecuteResponse,
  PlanAction,
  PlanConnect,
  PlanCreate,
  PlanView,
  ProposedPlan,
} from '../../src/types/assistant.js'

/** Contexto resumido do cérebro ativo: tudo que o assistente pode consultar. */
export interface BrainContext {
  brainId: string
  brainName: string
  schema: SchemaPayload
  types: NodeTypeDef[]
  connections: ConnectionDef[]
  contents: Content[]
  relations: Relation[]
}
