import type { Range } from '../lib/search'

/** Texto com trechos destacados. Usa elementos React (nunca HTML) e preserva o texto original. */
export function Highlight({ text, ranges }: { text: string; ranges?: Range[] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
