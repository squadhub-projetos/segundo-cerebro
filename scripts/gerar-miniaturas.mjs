// Gera miniaturas sem texto para public/referencias/midias a partir dos dados do pacote.
// As capas originais em squadhub-referencias-mock são preservadas; só as cópias publicadas são reescritas.
// Cada tipo tem um motivo próprio, na cor do conjunto. Uso: npm run gen:thumbs
import { readFileSync, writeFileSync } from 'node:fs'

const grafo = JSON.parse(readFileSync('src/data/grafo-completo.json', 'utf8'))
const colorOf = Object.fromEntries(grafo.collections.map((c) => [c.id, c.color]))

const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)

function motif(type, c, h) {
  const v = (n, span) => (h >> n) % span
  switch (type) {
    case 'criativo': {
      const ox = 330 + v(2, 90)
      const arcs = [110, 190, 270, 350, 430]
        .map((r, i) => {
          const a = 0.62
          const x1 = ox + r * Math.cos(-a)
          const y1 = 290 + r * Math.sin(-a)
          const x2 = ox + r * Math.cos(a)
          const y2 = 290 + r * Math.sin(a)
          return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${c}" stroke-width="${6 - i * 0.6}" stroke-linecap="round" opacity="${(0.9 - i * 0.14).toFixed(2)}"/>`
        })
        .join('')
      return `${arcs}<circle cx="${ox}" cy="290" r="34" fill="${c}"/><circle cx="${ox}" cy="290" r="62" fill="none" stroke="${c}" stroke-width="3" opacity=".4"/><circle cx="${760 - v(5, 80)}" cy="${120 + v(7, 60)}" r="9" fill="${c}" opacity=".7"/><circle cx="${820 - v(9, 60)}" cy="${420 - v(3, 50)}" r="6" fill="${c}" opacity=".5"/>`
    }
    case 'pagina': {
      const x = 170 + v(2, 40)
      return `<rect x="${x}" y="90" width="620" height="360" rx="28" fill="#0b1118" stroke="${c}" stroke-width="3" opacity=".95"/><path d="M${x} 150 H${x + 620}" stroke="${c}" stroke-width="2" opacity=".5"/><circle cx="${x + 36}" cy="120" r="9" fill="${c}"/><circle cx="${x + 66}" cy="120" r="9" fill="${c}" opacity=".6"/><circle cx="${x + 96}" cy="120" r="9" fill="${c}" opacity=".3"/><rect x="${x + 40}" y="185" width="330" height="150" rx="16" fill="${c}" opacity=".22"/><rect x="${x + 400}" y="185" width="180" height="22" rx="11" fill="${c}" opacity=".55"/><rect x="${x + 400}" y="226" width="150" height="14" rx="7" fill="${c}" opacity=".3"/><rect x="${x + 400}" y="256" width="170" height="14" rx="7" fill="${c}" opacity=".3"/><rect x="${x + 400}" y="300" width="110" height="34" rx="17" fill="${c}"/><rect x="${x + 40}" y="365" width="540" height="14" rx="7" fill="${c}" opacity=".25"/><rect x="${x + 40}" y="395" width="400" height="14" rx="7" fill="${c}" opacity=".2"/>`
    }
    case 'curso': {
      const dx = v(2, 50)
      const plate = (y, o, w) => `<rect x="${200 + dx + (3 - w) * 30}" y="${y}" width="${520 - (3 - w) * 60}" height="120" rx="24" fill="${c}" opacity="${o}" stroke="${c}" stroke-width="2.5"/>`
      return `${plate(340, 0.14, 1)}${plate(230, 0.22, 2)}${plate(120, 0.34, 3)}<circle cx="${200 + dx + 70}" cy="180" r="22" fill="${c}"/><rect x="${200 + dx + 120}" y="168" width="240" height="14" rx="7" fill="${c}" opacity=".7"/><rect x="${200 + dx + 120}" y="192" width="170" height="10" rx="5" fill="${c}" opacity=".4"/><path d="M${200 + dx + 70} 202 V470" stroke="${c}" stroke-width="2" stroke-dasharray="3 10" opacity=".4"/>`
    }
    default: {
      const x = 240 + v(2, 60)
      return `<path d="M${x} 130 H${x + 220} Q${x + 250} 130 ${x + 250} 160 V420 Q${x + 250} 450 ${x + 220} 450 H${x} Z" fill="${c}" opacity=".2" stroke="${c}" stroke-width="3"/><path d="M${x + 250} 160 Q${x + 250} 130 ${x + 280} 130 H${x + 500} V450 H${x + 280} Q${x + 250} 450 ${x + 250} 420" fill="none" stroke="${c}" stroke-width="3"/><rect x="${x + 36}" y="180" width="150" height="14" rx="7" fill="${c}" opacity=".7"/><rect x="${x + 36}" y="214" width="170" height="10" rx="5" fill="${c}" opacity=".4"/><rect x="${x + 36}" y="240" width="130" height="10" rx="5" fill="${c}" opacity=".4"/><rect x="${x + 290}" y="180" width="170" height="10" rx="5" fill="${c}" opacity=".4"/><rect x="${x + 290}" y="206" width="140" height="10" rx="5" fill="${c}" opacity=".4"/><circle cx="${x + 375}" cy="350" r="40" fill="none" stroke="${c}" stroke-width="4"/><path d="M${x + 355} 350 L${x + 371} 366 L${x + 398} 336" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
    }
  }
}

for (const item of grafo.contents) {
  const c = colorOf[item.collectionId] ?? '#8B98A8'
  const h = hash(item.id)
  const gx = 20 + (h % 60)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="Miniatura ilustrativa">
<defs><radialGradient id="g" cx="${gx}%" cy="${30 + ((h >> 4) % 40)}%" r="75%"><stop offset="0" stop-color="${c}" stop-opacity=".2"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>
<rect width="960" height="540" fill="#0b1233"/><rect width="960" height="540" fill="url(#g)"/>
${motif(item.type, c, h)}
</svg>
`
  writeFileSync(`public/referencias/${item.thumbnailPath}`, svg)
}
console.log(`${grafo.contents.length} miniaturas geradas em public/referencias/midias`)
