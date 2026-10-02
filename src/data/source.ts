/**
 * Configuração da fonte de dados (variáveis públicas do cliente, embutidas no build).
 *
 *  - VITE_DATA_SOURCE = monday | mock. Padrão: monday (em qualquer ambiente). Os mocks só entram com VITE_DATA_SOURCE=mock.
 *  - VITE_ALLOW_MOCK_FALLBACK = 1 (somente desenvolvimento): oferece "Usar demonstração" quando a monday falha.
 *
 * O token da monday NÃO fica aqui: ele existe apenas no servidor (MONDAY_API_TOKEN).
 */
export type DataSource = 'mock' | 'monday'

const configured = import.meta.env.VITE_DATA_SOURCE as string | undefined

export const DATA_SOURCE: DataSource =
  configured === 'mock' ? 'mock' : 'monday'

export const IS_LIVE = DATA_SOURCE === 'monday'

export const ALLOW_MOCK_FALLBACK = import.meta.env.DEV && import.meta.env.VITE_ALLOW_MOCK_FALLBACK === '1'
