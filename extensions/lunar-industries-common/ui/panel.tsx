import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons.tsx'
import './common.css'

// How the panel was closed: by Escape or its ×, which give the focus back, or by a click outside it, which leaves the
// focus where that click put it.
export type CloseReason = 'key' | 'button' | 'outside'

/**
 * The side panel the Lunar Industries modules share (the Kanban's branches without a task, a branch's detail): over
 * the page at the window's right edge, under the title bar, so that opening or closing it moves nothing on the page.
 * Its head (a title, its actions, a subtitle), its body that scrolls, its keys at the foot (hidden on a narrow
 * window). Escape or its × close it and give the focus back to what had it when the panel opened (or to
 * `returnFocus`), without scrolling the page to it. A click outside closes it too, except in a menu, in a dialog or
 * while one is open, and on what `keepOpenOn` names (the rows of a table, which open their own detail instead).
 */
export function SidePanel({
  title,
  mono = false,
  subtitle,
  actions,
  keys,
  label,
  keepOpenOn,
  returnFocus,
  onClose,
  children,
}: {
  title: ReactNode
  // A name (a branch) rather than words: in the monospaced font.
  mono?: boolean
  subtitle?: ReactNode
  // Buttons before the ×: a « ⋯ » for the menu.
  actions?: ReactNode
  // The keys at the foot: [keys, what they do].
  keys?: [string, string][]
  // The panel's name for a screen reader, when the title is not words enough.
  label?: string
  keepOpenOn?: string
  returnFocus?: () => HTMLElement | null
  onClose: (reason: CloseReason) => void
  children: ReactNode
}) {
  const id = useId()
  const box = useRef<HTMLElement>(null)
  // What had the focus when the panel opened: read while it draws, before anything in it takes the focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  const close = (reason: CloseReason) => {
    onClose(reason)
    if (reason === 'outside') return
    const back = returnFocus?.() ?? opener
    if (back?.isConnected) back.focus({ preventScroll: true })
  }
  const away = useEffectEvent((e: PointerEvent) => {
    const at = e.target instanceof Element ? e.target : null
    if (!at || box.current?.contains(at)) return
    if (at.closest('[role="menu"], dialog') || document.querySelector('dialog[open]')) return
    if (keepOpenOn && at.closest(keepOpenOn)) return
    close('outside')
  })
  useEffect(() => {
    const down = (e: PointerEvent) => away(e)
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [])

  return (
    <aside
      ref={box}
      className="lunar-panel"
      aria-labelledby={label ? undefined : `${id}-title`}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        e.stopPropagation()
        close('key')
      }}
    >
      <header className="lunar-panel-head">
        <div className="row">
          <h2 id={`${id}-title`} className={`grow lunar-panel-title${mono ? ' mono selectable' : ''}`}>
            {title}
          </h2>
          {actions}
          <button type="button" className="icon-btn" aria-label="Fermer (Échap)" title="Fermer (Échap)" onClick={() => close('button')}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {subtitle && <p className="legend">{subtitle}</p>}
      </header>
      <div className="lunar-panel-body">{children}</div>
      {keys && keys.length > 0 && (
        <footer className="lunar-panel-foot legend">
          {keys.map(([k, what]) => (
            <span key={k}>
              <kbd>{k}</kbd> {what}
            </span>
          ))}
        </footer>
      )}
    </aside>
  )
}
