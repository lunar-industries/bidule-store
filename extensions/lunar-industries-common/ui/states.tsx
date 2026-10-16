import type { ReactNode } from 'react'
import './common.css'

/**
 * What a page says while it reads, when a reading failed and when there is nothing to show (the « Composants communs
 * Lunar » maquette), the same in every Lunar Industries module.
 */

// A reading that failed above what is still shown (the last reading): one sentence that says what failed and what is
// shown instead, then « Réessayer ».
export function Alert({ children, retry, retryLabel = 'Réessayer' }: { children: ReactNode; retry?: () => void; retryLabel?: string }) {
  return (
    <div className="row lunar-alert" role="alert">
      <span className="grow">{children}</span>
      {retry && (
        <button type="button" className="btn lunar-btn-sm" onClick={retry}>
          {retryLabel}
        </button>
      )}
    </div>
  )
}

// A reading under way, always told to a screen reader; `lines` draws grey lines where the content will be.
export function Loading({ children, lines = 0 }: { children: ReactNode; lines?: number }) {
  if (!lines)
    return (
      <p className="muted" role="status">
        {children}
      </p>
    )
  return (
    <div className="lunar-loading">
      <span className="legend" role="status">
        {children}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="lunar-loading-line" aria-hidden="true" />
      ))}
    </div>
  )
}

// Nothing to show: a title, a sentence, an action. `failed`: the first reading failed and there is nothing else to show.
export function Empty({
  title,
  children,
  action,
  failed = false,
}: {
  title: ReactNode
  children?: ReactNode
  action?: { label: string; run: () => void } | ReactNode
  failed?: boolean
}) {
  const button =
    action && typeof action === 'object' && 'label' in action && 'run' in action ? (
      <button type="button" className="btn" onClick={action.run}>
        {action.label}
      </button>
    ) : (
      (action as ReactNode)
    )
  return (
    <section className={`empty lunar-empty${failed ? ' failed' : ''}`} role={failed ? 'alert' : undefined}>
      <h2 className="lunar-empty-title">{title}</h2>
      {children && <p className="legend">{children}</p>}
      {button}
    </section>
  )
}
