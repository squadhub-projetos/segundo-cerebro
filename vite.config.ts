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
      const env = loadEnv(server.config.mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        if (key.startsWith('MONDAY_') && process.env[key] === undefined) process.env[key] = value
      }
      const route = (path: string, handlerName: 'handleGraph' | 'handleSchema' | 'handleMutate') =>
        server.middlewares.use(path, async (req, res) => {
          try {
            const mod = await server.ssrLoadModule('/server/monday/handler.ts')
            await (mod[handlerName] as (req: unknown, res: unknown) => Promise<void>)(req, res)
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'internal', message: (error as Error).message }))
          }
        })
      route('/api/graph', 'handleGraph')
      route('/api/schema', 'handleSchema')
      route('/api/mutate', 'handleMutate')
    },
  }
}

export default defineConfig({
  plugins: [react(), mondayApi()],
})
