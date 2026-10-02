import type { Content, Theme } from '../types'
import { TYPE_NAME } from './relations'

/** Intervalo [início, fim) no texto ORIGINAL (nunca no texto normalizado). */
export type Range = [number, number]

export interface MatchInfo {
  /** Trechos do título que casam com a consulta. */
  titleRanges: Range[]
  /** Motivo adicional, quando o título sozinho não explica a correspondência. */
  extra: ExtraReason | null
}

export type ExtraReason =
  | { kind: 'theme'; text: string; ranges: Range[] }
  | { kind: 'meta'; label: string; text: string; ranges: Range[] }
  | { kind: 'description'; text: string; ranges: Range[] }

interface Folded {
  text: string
  /** Para cada caractere normalizado, onde ele começa e termina no original. */
  starts: number[]
  ends: number[]
}

/** Remove acentos e ignora maiúsculas, guardando o mapeamento para o texto original. */
function fold(original: string): Folded {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  let index = 0
  for (const ch of original) {
    const next = index + ch.length
    const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (const f of folded) {
      for (let k = 0; k < f.length; k++) {
        text += f[k]
        starts.push(index)
        ends.push(next)
      }
    }
    index = next
  }
  return { text, starts, ends }
}

/** Termos da consulta, normalizados. Sem regex: apenas busca de substring. */
export function queryTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => fold(t).text)
    .filter(Boolean)
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

function findRanges(folded: Folded, terms: string[]): Range[] {
  const ranges: Range[] = []
  for (const term of terms) {
    let from = 0
    for (;;) {
      const at = folded.text.indexOf(term, from)
      if (at === -1) break
      ranges.push([folded.starts[at], folded.ends[at + term.length - 1]])
      from = at + term.length
    }
  }
  return mergeRanges(ranges)
}

function hasTerm(folded: Folded, term: string) {
  return folded.text.includes(term)
}

const SNIPPET_RADIUS = 30

function snippetAround(description: string, folded: Folded, term: string, terms: string[]) {
  const at = folded.text.indexOf(term)
  const start = Math.max(0, folded.starts[at] - SNIPPET_RADIUS)
  const end = Math.min(description.length, folded.ends[at + term.length - 1] + SNIPPET_RADIUS)
  const body = description.slice(start, end).trim()
  const text = `${start > 0 ? '…' : ''}${body}${end < description.length ? '…' : ''}`
  const offset = start > 0 ? 1 : 0
  const ranges = findRanges(fold(text), terms).filter(([s]) => s >= offset)
  return { text, ranges }
}

/** Todos os termos precisam aparecer no título, na descrição ou em algum tema. */
export function matchContent(content: Content, terms: string[], themes: Theme[]): MatchInfo | null {
  if (terms.length === 0) return null
  const title = fold(content.title)
  const description = fold(content.description)
  const themeFolds = content.themes.map((id) => {
    const label = themes.find((t) => t.id === id)?.label ?? id
    return { label, folded: fold(label) }
  })

  // Metadados da origem (plataforma, status, etc.) e o tipo também são pesquisáveis.
  const metaFolds = [
    { label: 'Tipo', value: TYPE_NAME[content.type] },
    ...(content.metadata ?? []),
  ].map((m) => ({ label: m.label, value: m.value, folded: fold(`${m.label} ${m.value}`), valueFolded: fold(m.value) }))

  let extra: ExtraReason | null = null
  for (const term of terms) {
    if (hasTerm(title, term)) continue
    const theme = themeFolds.find((t) => hasTerm(t.folded, term))
    const meta = theme ? undefined : metaFolds.find((m) => hasTerm(m.folded, term))
    if (theme) {
      extra ??= { kind: 'theme', text: theme.label, ranges: findRanges(theme.folded, terms) }
    } else if (meta) {
      extra ??= { kind: 'meta', label: meta.label, text: meta.value, ranges: findRanges(meta.valueFolded, terms) }
    } else if (hasTerm(description, term)) {
      extra ??= { kind: 'description', ...snippetAround(content.description, description, term, terms) }
    } else {
      return null
    }
  }
  return { titleRanges: findRanges(title, terms), extra }
}
