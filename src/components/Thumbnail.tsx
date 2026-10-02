import { useState } from 'react'
import type { Content } from '../types'
import { thumbnailUrl } from '../lib/media'
import { TYPE_META, collectionColor } from './meta'

/** Capa local usada quando o conteúdo não tem imagem ou a imagem falha ao carregar. */
function CoverFallback({ content }: { content: Content }) {
  const color = collectionColor(content.collectionId)
  const { Icon, label } = TYPE_META[content.type]
  return (
    <div className="cover-fallback" style={{ '--cover-accent': color } as React.CSSProperties}>
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle cx="270" cy="30" r="110" fill="var(--cover-accent)" opacity="0.07" />
        <circle cx="270" cy="30" r="72" fill="none" stroke="var(--cover-accent)" opacity="0.3" />
        <circle cx="40" cy="170" r="60" fill="none" stroke="var(--cover-accent)" opacity="0.15" />
        <path d="M0 130 H320" stroke="var(--cover-accent)" opacity="0.12" />
      </svg>
      <Icon className="cover-fallback-icon" aria-hidden="true" />
      <span className="cover-fallback-label">{label}</span>
    </div>
  )
}

interface Props {
  content: Content
  className?: string
}

export function Thumbnail({ content, className }: Props) {
  const url = thumbnailUrl(content.thumbnailPath)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = url !== null && failedUrl !== url
  return (
    <div className={`thumb ${className ?? ''}`}>
      {showImage ? (
        <img src={url} alt="" draggable={false} onError={() => setFailedUrl(url)} />
      ) : (
        <CoverFallback content={content} />
      )}
    </div>
  )
}
