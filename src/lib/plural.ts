/**
 * Sugestão de plural (pt-BR) para o nome do board de um tipo ("Cliente" → "Clientes"). É só uma sugestão: o campo pode ser
 * editado. Palavras terminadas em consoantes pouco comuns (por exemplo "LinkedIn") ficam como estão.
 */
export function pluralize(name: string): string {
  const w = name.trim()
  if (!w) return ''
  const lower = w.toLowerCase()
  if (/ão$/.test(lower)) return `${w.slice(0, -2)}ões`
  if (/[rz]$/.test(lower)) return `${w}es`
  if (/m$/.test(lower)) return `${w.slice(0, -1)}ns`
  if (/l$/.test(lower)) return `${w.slice(0, -1)}is`
  if (/s$/.test(lower)) return w
  if (/[aeiouáéíóúâêôãõ]$/.test(lower)) return `${w}s`
  return w
}
