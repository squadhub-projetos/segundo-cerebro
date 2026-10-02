export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Erro de uma resposta HTTP (o servidor respondeu). Nunca é confundido com falha de rede: usa a mensagem do servidor quando
 * existe e, senão, descreve o status.
 */
export function httpError(path: string, status: number, code?: string, message?: string): ProviderError {
  const fallback =
    status === 401 || status === 403
      ? 'Operação não autorizada pelo servidor.'
      : status === 404
        ? 'Endpoint não encontrado no servidor.'
        : status === 405
          ? 'Método não permitido neste endpoint.'
          : status === 504
            ? 'O servidor demorou demais para responder.'
            : status >= 500
              ? 'Erro no servidor ao falar com a monday.'
              : 'Requisição recusada pelo servidor.'
  console.error(`[SecondBrain] ${path} respondeu HTTP ${status}${code ? ` (${code})` : ''}`)
  return new ProviderError(code ?? `http_${status}`, `${message ?? fallback} (HTTP ${status})`)
}
