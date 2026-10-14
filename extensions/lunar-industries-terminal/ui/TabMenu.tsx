import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal, openDialog } from '@bidule/sdk'
import { TAB_COLORS, type TabColor } from './order.ts'
import { terminals, type TerminalTab } from './tabs.ts'

const COLOR_NAMES: Record<TabColor, string> = {
  coral: 'Corail',
  mint: 'Menthe',
  butter: 'Beurre',
  blue: 'Bleu',
  pink2: 'Rose',
}

// The user's name for a tab: empty goes back to the shell's title.
export function renameTab(tab: TerminalTab) {
  openDialog((close) => <RenameDialog tab={tab} close={close} />)
}

function RenameDialog({ tab, close }: { tab: TerminalTab; close: () => void }) {
  const [name, setName] = useState(tab.name ?? '')
  const done = () => {
    close()
    tab.term.focus()
  }
  return (
    <Modal label="Renommer le terminal" onClose={done}>
      <form
        className="fields"
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          terminals.rename(tab, name)
          done()
        }}
      >
        <h2 className="wide">Renommer le terminal</h2>
        <label className="field wide">
          Nom
          <input autoFocus value={name} placeholder={tab.title} onChange={(e) => setName(e.target.value)} />
          <span className="hint muted">Vide : le titre que donne le shell.</span>
        </label>
        <div className="row wide">
          <span className="grow" />
          <button type="button" className="btn" onClick={done}>
            Annuler
          </button>
          <button type="submit" className="btn-cta">
            Renommer
          </button>
        </div>
      </form>
    </Modal>
  )
}

// A tab's right click: rename it, colour it, close it. Closes on a click elsewhere or Escape.
export function TabMenu({ tab, x, y, close }: { tab: TerminalTab; x: number; y: number; close: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
    const away = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && close()
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    addEventListener('mousedown', away)
    addEventListener('keydown', esc, true)
    return () => {
      removeEventListener('mousedown', away)
      removeEventListener('keydown', esc, true)
    }
  }, [close])
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  // In the page's body: the tabs sit on the banner's edge, moved by a transform, which would make a fixed menu inside
  // them open away from the click.
  return createPortal(
    <div
      ref={menu}
      className="menu floating"
      role="menu"
      aria-label={tab.label}
      style={{ left: Math.min(x, innerWidth - 240), top: Math.min(y, innerHeight - 200) }}
    >
      <button type="button" role="menuitem" className="menu-item" onClick={run(() => renameTab(tab))}>
        Renommer…
      </button>
      <div className="row lterm-colors" role="group" aria-label="Couleur">
        <button
          type="button"
          className="lterm-color none"
          aria-pressed={tab.color === null}
          aria-label="Sans couleur"
          title="Sans couleur"
          onClick={run(() => terminals.recolor(tab, null))}
        />
        {TAB_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="lterm-color"
            style={{ background: `var(--${c})` }}
            aria-pressed={tab.color === c}
            aria-label={COLOR_NAMES[c]}
            title={COLOR_NAMES[c]}
            onClick={run(() => terminals.recolor(tab, c))}
          />
        ))}
      </div>
      <hr className="menu-sep" />
      <button type="button" role="menuitem" className="menu-item" onClick={run(() => terminals.close(tab))}>
        Fermer
      </button>
    </div>,
    document.body,
  )
}
