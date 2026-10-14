import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BannerTools, openPalette, setPaletteScope, useHint } from '@bidule/sdk'
import { pathsOfUriList } from './paths.ts'
import { TerminalSearch } from './Search.tsx'
import { scriptsScope } from './script-commands.ts'
import { TabStrip } from './TabStrip.tsx'
import { terminals } from './tabs.ts'
import './lterm.css'

// What a drop carries that is a file: the file managers give their paths as `file://` URIs.
const carriesFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('Files')

/**
 * A free terminal, in tabs: the user's shells, run by the desktop app (see tabs.ts). In a plain browser
 * (`npm run dev:web`) there is no shell to run: the page says so. Taken from the official terminal, itself from
 * quack-board (pages/terminal); drawn by ghostty-web.
 */
export function TerminalPage() {
  // The tabs live in a shared object that changes in place (ghostty-web views, shells): not memoized, drawn as they
  // are.
  'use no memo'
  useSyncExternalStore(terminals.subscribe, terminals.version)
  const host = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; selection: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  useHint('Tape, je regarde. Enfin, je fais semblant. Coin.')
  // Ctrl+K here opens the palette on the scripts of the active tab's repo.
  useEffect(() => setPaletteScope(scriptsScope), [])

  useEffect(() => {
    const el = host.current
    if (!el || !terminals.available) return
    void terminals.attach(el)
    // The panel follows the window's size: the terminal re-counts its rows and columns.
    const resized = new ResizeObserver(() => terminals.fit())
    resized.observe(el)
    return () => {
      resized.disconnect()
      terminals.detach()
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const away = () => setMenu(null)
    addEventListener('mousedown', away)
    return () => removeEventListener('mousedown', away)
  }, [menu])

  const active = terminals.active
  // In a split tab, what is aimed at a pane (a right click, a dropped file) gives it the focus first.
  const aim = (target: EventTarget) => {
    const index = active?.panes.findIndex((p) => p.box.contains(target as Node)) ?? -1
    if (index >= 0) terminals.focusPane(index, active, false)
  }
  const run = (fn: () => unknown) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenu(null)
    void fn()
  }

  return (
    <div className={`page fill${terminals.available ? ' with-tools' : ''}`}>
      {terminals.available && (
        <BannerTools>
          {terminals.tabs.length > 0 && <TabStrip />}
          <button type="button" className="banner-button" title="Les scripts du dépôt (Ctrl+K)" onClick={() => openPalette(scriptsScope())}>
            Scripts
          </button>
          <button type="button" className="banner-button round" aria-label="Nouveau terminal" title="Nouveau terminal (Ctrl+Maj+T)" onClick={() => void terminals.add()}>
            +
          </button>
        </BannerTools>
      )}

      <section className="panel lterm-panel" aria-label="Terminal">
        {terminals.available ? (
          <>
            {/* ghostty-web draws the active tab here; the same view comes back each time the page opens. */}
            <div
              className={`lterm-host${dropping ? ' dropping' : ''}`}
              ref={host}
              // A file dropped on the terminal: its path at the prompt, quoted for the tab's shell.
              onDragOver={(e) => {
                if (!carriesFiles(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDropping(true)
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                setDropping(false)
                if (!carriesFiles(e)) return
                e.preventDefault()
                aim(e.target)
                // Their paths on disk from Electron (any file manager, any system), else the `file://` URIs some give.
                const pathOf = (window as { bidule?: { pathOf?: (f: File) => string } }).bidule?.pathOf
                const onDisk = pathOf ? [...e.dataTransfer.files].map((f) => pathOf(f)).filter(Boolean) : []
                terminals.drop(onDisk.length ? onDisk : pathsOfUriList(e.dataTransfer.getData('text/uri-list')))
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                aim(e.target)
                setMenu({ x: e.clientX, y: e.clientY, selection: Boolean(active?.term.hasSelection()) })
              }}
            />
            {terminals.searching && <TerminalSearch />}
            {active?.state === 'exited' && (
              <div className="row lterm-ended">
                <span className="legend">Le shell s'est arrêté{active.exitCode ? ` (code ${active.exitCode})` : ''}.</span>
                <button type="button" className="btn-cta" onClick={() => void terminals.start(active)}>
                  Relancer
                </button>
              </div>
            )}
            {!active && (
              <div className="lterm-empty">
                {/* What keeps a terminal from loading (WebAssembly refused), in place of the first line. */}
                <span className="muted">{terminals.problem ?? 'Aucun terminal ouvert.'}</span>
                <button type="button" className="btn-cta" onClick={() => void terminals.add().catch(() => undefined)}>
                  Nouveau terminal
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty">Le terminal ne fonctionne que dans l'application de bureau.</div>
        )}
      </section>

      {/* Right click in the terminal: the clipboard, then the tab. */}
      {menu && (
        <div className="menu floating" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" className="menu-item menu-shortcut" aria-disabled={!menu.selection} onClick={run(() => terminals.copy())}>
            Copier <kbd>Ctrl+Maj+C</kbd>
          </button>
          <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.paste())}>
            Coller <kbd>Ctrl+Maj+V</kbd>
          </button>
          <button type="button" className="menu-item" onClick={run(() => terminals.selectAll())}>
            Tout sélectionner
          </button>
          <button type="button" className="menu-item" onClick={run(() => terminals.clear())}>
            Effacer
          </button>
          <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.openSearch())}>
            Rechercher <kbd>Ctrl+Maj+F</kbd>
          </button>
          <hr className="menu-sep" />
          <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.add())}>
            Nouveau terminal <kbd>Ctrl+Maj+T</kbd>
          </button>
          {active && (
            <>
              <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.split('row'))}>
                {active.split && active.direction === 'column' ? 'Volets côte à côte' : 'Diviser à droite'} <kbd>Ctrl+Maj+E</kbd>
              </button>
              <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.split('column'))}>
                {active.split && active.direction === 'row' ? 'Volets l’un sous l’autre' : 'Diviser en bas'} <kbd>Ctrl+Maj+O</kbd>
              </button>
              {active.split ? (
                <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.closePane(active))}>
                  Fermer ce volet <kbd>Ctrl+Maj+W</kbd>
                </button>
              ) : (
                <button type="button" className="menu-item menu-shortcut" onClick={run(() => terminals.close(active))}>
                  Fermer ce terminal <kbd>Ctrl+Maj+W</kbd>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
