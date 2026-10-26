/**
 * Cliente mínimo da Responses API da OpenAI (somente servidor). A chave vem de OPENAI_API_KEY e nunca sai daqui; o modelo vem
 * de OPENAI_MODEL. Sem estado no provedor (`store: false`): o histórico é reenviado a cada chamada.
 */

export class AiError extends Error {
  constructor(
    public code: 'ai_not_configured' | 'ai_unavailable' | 'ai_rate_limited' | 'ai_bad_response',
    message: string,
  ) {
    super(message)
  }
}

export interface AiConfig {
  apiKey: string
  model: string
  baseUrl: string
  /** Máximo de voltas do ciclo de tools por pedido. */
  maxSteps: number
}

/** Modelo padrão: bom custo/desempenho para interpretar texto e chamar funções. Troque com OPENAI_MODEL. */
export const DEFAULT_MODEL = 'gpt-5.4-mini'

export function readAiConfig(env: Record<string, string | undefined>): AiConfig {
  return {
    apiKey: (env.OPENAI_API_KEY ?? '').trim(),
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    maxSteps: Number(env.AI_MAX_STEPS ?? 10) || 10,
  }
}

export const aiEnabled = (env: Record<string, string | undefined>) => env.AI_ENABLED?.trim() !== '0' && Boolean(readAiConfig(env).apiKey)

/** Item de entrada/saída da Responses API (tipos abertos de propósito: reenviamos os itens como vieram). */
export type ResponseItem = Record<string, unknown> & { type?: string }

export interface ResponseResult {
  output: ResponseItem[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface FunctionTool {
  type: 'function'
  name: string
  description: string
  strict: true
  parameters: Record<string, unknown>
}

export async function createResponse(
  config: AiConfig,
  body: { instructions: string; input: ResponseItem[]; tools: FunctionTool[] },
): Promise<ResponseResult> {
  if (!config.apiKey) throw new AiError('ai_not_configured', 'OPENAI_API_KEY não está configurada no servidor.')
  const payload = JSON.stringify({ model: config.model, store: false, max_output_tokens: 2500, ...body })
  let lastStatus = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 50_000)
    try {
      const response = await fetch(`${config.baseUrl}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      })
      lastStatus = response.status
      if (response.ok) return (await response.json()) as ResponseResult
      // Uma nova tentativa só para limite de uso e falhas do provedor. Nunca registramos corpo, chave ou cabeçalhos.
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 800))
        continue
      }
      console.error(`[SecondBrain] OpenAI respondeu HTTP ${response.status}`)
      throw new AiError(response.status === 429 ? 'ai_rate_limited' : 'ai_unavailable', `A OpenAI recusou a requisição (HTTP ${response.status}).`)
    } catch (error) {
      if (error instanceof AiError) throw error
      if (attempt === 0) continue
      console.error('[SecondBrain] Falha de rede ao chamar a OpenAI:', (error as Error).name)
      throw new AiError('ai_unavailable', 'Não foi possível falar com a OpenAI.')
    } finally {
      clearTimeout(timer)
    }
  }
  throw new AiError('ai_unavailable', `A OpenAI não respondeu (HTTP ${lastStatus}).`)
}

/** Texto final de uma resposta (junta os blocos `output_text` das mensagens). */
export function outputText(output: ResponseItem[]): string {
  const parts: string[] = []
  for (const item of output) {
    if (item.type !== 'message') continue
    for (const c of (item.content as { type?: string; text?: string }[] | undefined) ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text)
    }
  }
  return parts.join('\n').trim()
}
