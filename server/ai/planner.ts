import { AiError, createResponse, outputText, readAiConfig } from './client.js'
import type { ResponseItem } from './client.js'
import { PlanBuilder, describePlan } from './plan.js'
import { buildInstructions } from './prompt.js'
import { READ_TOOLS, TOOLS, WRITE_TOOLS, runTool } from './tools.js'
import type { ActionPlan, BrainContext, ChatResponse, ChatTurn } from './types.js'

/**
 * Fase de interpretação: um ciclo de tools da Responses API. A IA pode ler (schema, busca, detalhes) e PROPOR (create/connect
 * só registram no plano). Nada é gravado aqui; o resultado é uma mensagem e, se houver ações, um plano para confirmação.
 */

interface FunctionCall extends ResponseItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export async function planFromChat(
  env: Record<string, string | undefined>,
  ctx: BrainContext,
  history: ChatTurn[],
  currentPlan: ActionPlan | null,
): Promise<ChatResponse> {
  const config = readAiConfig(env)
  const builder = new PlanBuilder(ctx)
  const lastUser = [...history].reverse().find((t) => t.role === 'user')?.content ?? ''
  const instructions = buildInstructions(ctx, lastUser, currentPlan ? describePlan(currentPlan, ctx) : null)
  const input: ResponseItem[] = history.map((t) => ({ role: t.role, content: t.content }))

  let nudged = false
  for (let step = 0; step < config.maxSteps; step++) {
    const { output } = await createResponse(config, { instructions, input, tools: TOOLS })
    const calls = output.filter((o): o is FunctionCall => o.type === 'function_call')
    if (calls.length === 0) {
      const message = outputText(output)
      if (!message) throw new AiError('ai_bad_response', 'A IA não retornou texto.')
      // Salvaguarda: a resposta propõe criar algo, mas nenhuma ação foi registrada pelas ferramentas.
      if (!builder.actions.length && !nudged && /posso criar isso agora|entendi que você quer criar/i.test(message)) {
        nudged = true
        input.push({ role: 'assistant', content: message })
        input.push({ role: 'user', content: '(Sistema) Você descreveu ações, mas não as registrou. Chame create_content e connect_content para registrar o plano agora e responda de novo.' })
        continue
      }
      const plan = builder.plan()
      return { message, plan: plan.actions.length ? { ...plan, view: describePlan(plan, ctx) } : null }
    }
    // Os itens de saída (inclusive os raciocínios) voltam como entrada, seguidos do resultado de cada tool.
    input.push(...output)
    for (const call of calls) {
      const known = READ_TOOLS.has(call.name) || WRITE_TOOLS.has(call.name)
      const result = known ? runTool(call.name, call.arguments, ctx, builder) : { error: `Ferramenta desconhecida: ${call.name}.` }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }
  }
  throw new AiError('ai_bad_response', 'A IA não concluiu a análise a tempo.')
}
