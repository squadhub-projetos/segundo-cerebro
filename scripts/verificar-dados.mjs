// Confere IDs, relações e caminhos de mídia do pacote importado. Uso: npm run verify:data
import { existsSync, readFileSync } from 'node:fs'

const grafo = JSON.parse(readFileSync('src/data/grafo-completo.json', 'utf8'))
const ids = new Set(grafo.contents.map((c) => c.id))
const problemas = []

if (grafo.contents.length !== 30) problemas.push(`Esperados 30 conteúdos, há ${grafo.contents.length}`)
if (grafo.relations.length !== 27) problemas.push(`Esperadas 27 relações, há ${grafo.relations.length}`)
if (ids.size !== grafo.contents.length) problemas.push('IDs de conteúdo duplicados')

for (const c of grafo.contents) {
  if (!existsSync(`public/referencias/${c.thumbnailPath}`)) problemas.push(`Mídia ausente: ${c.id} -> ${c.thumbnailPath}`)
  if (!grafo.collections.some((x) => x.id === c.collectionId)) problemas.push(`Conjunto inexistente em ${c.id}`)
  for (const t of c.themes) if (!grafo.themes.some((x) => x.id === t)) problemas.push(`Tema inexistente em ${c.id}: ${t}`)
  if (!grafo.positions[c.id]) problemas.push(`Sem posição inicial: ${c.id}`)
}
for (const r of grafo.relations) {
  if (!ids.has(r.source) || !ids.has(r.target)) problemas.push(`Relação ${r.id} com ID inexistente`)
  if (r.source === r.target) problemas.push(`Relação ${r.id} é autorrelação`)
}

if (problemas.length) {
  console.error(problemas.join('\n'))
  process.exit(1)
}
console.log(`OK: ${grafo.contents.length} conteúdos, ${grafo.relations.length} relações, ${grafo.contents.length} mídias.`)
