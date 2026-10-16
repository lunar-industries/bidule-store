import { useState } from 'react'
import { Modal, openDialog } from '@bidule/sdk'
import type { MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
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

// A tab's right click, in the common menu: rename it, colour it, close it (asked first while a command runs there).
export function tabEntries(tab: TerminalTab): MenuEntry[] {
  return [
    { label: 'Renommer…', run: () => renameTab(tab) },
    {
      label: 'Couleur de l’onglet',
      // The arrows reach the swatches as the items (menuitemradio); a click colours the tab and leaves the menu open.
      row: (
        <div className="row lterm-colors">
          <button
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            className="lterm-color none"
            aria-checked={tab.color === null}
            aria-label="Sans couleur"
            title="Sans couleur"
            onClick={() => terminals.recolor(tab, null)}
          />
          {TAB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              className="lterm-color"
              style={{ background: `var(--${c})` }}
              aria-checked={tab.color === c}
              aria-label={COLOR_NAMES[c]}
              title={COLOR_NAMES[c]}
              onClick={() => terminals.recolor(tab, c)}
            />
          ))}
        </div>
      ),
    },
    'separator',
    { label: 'Fermer', run: () => terminals.askClose(tab), shortcut: 'Ctrl+Maj+W' },
  ]
}
