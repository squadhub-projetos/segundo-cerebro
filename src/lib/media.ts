/** Resolve o caminho da capa usando a base pública do Vite. */
export function thumbnailUrl(path: string | null): string | null {
  if (!path) return null
  // Miniaturas externas (por exemplo, do YouTube) vêm como URL absoluta.
  if (/^https:\/\//.test(path)) return path
  return `${import.meta.env.BASE_URL}referencias/${path}`
}
