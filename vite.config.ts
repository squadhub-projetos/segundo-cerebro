import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Em desenvolvimento serve /api/graph e /api/schema com o MESMO código das funções da Vercel (server/monday/handler.ts),
 * lendo o .env no servidor do Vite. O token nunca chega ao navegador (não usa o prefixo VITE_).
 */
function mondayApi(): Plugin {
  return {
    name: 'monday-api',
    configureServer(server) {
      // Variáveis do servidor (monday e assistente) lidas do .env; nada com prefixo VITE_ e nada disso chega ao navegador.
      // Relido a cada requisição: trocar o token no .env vale na hora, sem reiniciar o Vite. Variáveis já definidas
      // no processo (shell/sistema) têm prioridade; só atualizamos as que nós mesmos copiamos do arquivo.
      const fromFile = new Set<string>()
      const syncEnv = () => {
        const env = loadEnv(server.config.mode, process.cwd(), '')
        for (const [key, value] of Object.entries(env)) {
          if (!/^(MONDAY_|OPENAI_|AI_|SCHEMA_|ALLOWED_ORIGINS|APP_ORIGIN)/.test(key)) continue
          if (process.env[key] === undefined || fromFile.has(key)) {
            process.env[key] = value
            fromFile.add(key)
          }
        }
      }
      syncEnv()
      const route = (path: string, file: string, handlerName: string) =>
        server.middlewares.use(path, async (req, res) => {
          try {
            syncEnv()
            const mod = await server.ssrLoadModule(file)
            await (mod[handlerName] as (req: unknown, res: unknown) => Promise<void>)(req, res)
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'internal', message: (error as Error).message }))
          }
        })
      const monday = '/server/monday/handler.ts'
      const ai = '/server/ai/handler.ts'
      route('/api/graph', monday, 'handleGraph')
      route('/api/schema', monday, 'handleSchema')
      route('/api/mutate', monday, 'handleMutate')
      route('/api/structure', monday, 'handleStructure')
      route('/api/ai/chat', ai, 'handleAiChat')
      route('/api/ai/execute', ai, 'handleAiExecute')
    },
  }
}

export default defineConfig({
  plugins: [react(), mondayApi()],
})
