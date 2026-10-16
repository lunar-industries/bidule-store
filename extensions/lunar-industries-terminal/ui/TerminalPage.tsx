import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BannerTools, navigate, openPalette, setPaletteScope, useHint, useMascotClearance } from '@bidule/sdk'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import { useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import { Empty, Loading } from '@bidule/ext-lunar-industries-common/ui/states'
import { pathsOfUriList } from './paths.ts'
import { TerminalSearch } from './Search.tsx'
import { scriptsScope } from './script-commands.ts'
import { TabStrip } from './TabStrip.tsx'
import { terminals } from './tabs.ts'
import { useThemeNotice } from './theme-notice.ts'
import './lterm.css'

// What a drop carries that is a file: the file managers give their paths as `file://` URIs.
const carriesFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('Files')

/**
 * A free terminal, in tabs: the user's shells, run by the desktop app (see tabs.ts). In a plain browser
 * (`npm run dev:web`) there is no shell to run: the page says so. Taken from the official terminal, itself from
 * quack-board (pages/terminal); drawn by ghostty-web, as the « Terminal Lunar » maquette draws its page.
 */
export function TerminalPage() {
  // The tabs live in a shared object that changes in place (ghostty-web views, shells): not memoized, drawn as they
  // are.
  'use no memo'
  useSyncExternalStore(terminals.subscribe, terminals.version)
  const host = useRef<HTMLDivElement>(null)
  const [menu, openMenu] = useMenu()
  const [dropping, setDropping] = useState(false)
  useHint('Tape, je regarde. Enfin, je fais semblant. Coin.')
  useThemeNotice()
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

  const active = terminals.active
  // The line « Relancer » at the bottom: in focus mode, the mascot stays above it.
  const ended = active?.state === 'exited'
  useMascotClearance(ended ? 64 : 0)
  // No terminal can be made (WebAssembly refused…): what would only fail is not offered.
  const broken = Boolean(terminals.problem) && !active

  // In a split tab, what is aimed at a pane (a right click, a dropped file) gives it the focus first.
  const aim = (target: EventTarget) => {
    const index = active?.panes.findIndex((p) => p.box.contains(target as Node)) ?? -1
    if (index >= 0) terminals.focusPane(index, active, false)
  }

  // Right click in the terminal: the clipboard, then the tab (the common menu).
  const entries = (): MenuEntry[] => [
    { label: 'Copier', shortcut: 'Ctrl+Maj+C', run: () => terminals.copy(), disabled: active?.term.hasSelection() ? false : 'Rien n’est sélectionné' },
    { label: 'Coller', shortcut: 'Ctrl+Maj+V', run: () => terminals.paste() },
    { label: 'Tout sélectionner', run: () => terminals.selectAll() },
    { label: 'Effacer', run: () => terminals.clear() },
    { label: 'Rechercher', shortcut: 'Ctrl+Maj+R', run: () => terminals.openSearch() },
    'separator',
    { label: 'Nouveau terminal', shortcut: 'Ctrl+Maj+T', run: () => terminals.add() },
    active && {
      label: active.split && active.direction === 'column' ? 'Volets côte à côte' : 'Diviser à droite',
      shortcut: 'Ctrl+Maj+E',
      run: () => terminals.split('row'),
    },
    active && {
      label: active.split && active.direction === 'row' ? 'Volets l’un sous l’autre' : 'Diviser en bas',
      shortcut: 'Ctrl+Maj+O',
      run: () => terminals.split('column'),
    },
    active && {
      label: active.split ? 'Fermer ce volet' : 'Fermer ce terminal',
      shortcut: 'Ctrl+Maj+W',
      run: () => terminals.askClose(active, active.pane),
    },
  ]

  return (
    <div className={`page fill${terminals.available ? ' with-tools' : ''}`}>
      {terminals.available && !broken && (
        <BannerTools>
          {terminals.tabs.length > 0 && <TabStrip />}
          {active && (
            <button
              type="button"
              className="banner-button round"
              aria-label="Rechercher dans le terminal (Ctrl+Maj+R)"
              title="Rechercher (Ctrl+Maj+R)"
              onClick={() => terminals.openSearch()}
            >
              <Icon name="search" />
            </button>
          )}
          <button type="button" className="banner-button" title="Les scripts du dépôt (Ctrl+K)" onClick={() => openPalette(scriptsScope())}>
            Scripts
          </button>
          <button type="button" className="banner-button round" aria-label="Nouveau terminal (Ctrl+Maj+T)" title="Nouveau terminal (Ctrl+Maj+T)" onClick={() => void terminals.add()}>
            <Icon name="plus" />
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
                aim(e.target)
                openMenu(e, entries(), 'Terminal')
              }}
            />
            {terminals.searching && <TerminalSearch />}
            {ended && (
              <div className="row lterm-ended">
                <span className="legend">Le shell s’est arrêté{active.exitCode ? ` (code ${active.exitCode})` : ''}.</span>
                <button type="button" className="btn-cta" onClick={() => void terminals.start(active)}>
                  Relancer
                </button>
              </div>
            )}
            {!active && (
              <div className="lterm-empty">
                {broken ? (
                  <Empty
                    title="Ce terminal ne peut pas se charger."
                    failed
                    action={{ label: 'Réglages › Rôles', run: () => navigate('/reglages/roles') }}
                  >
                    {terminals.problem}
                  </Empty>
                ) : terminals.opening ? (
                  <Loading>Ouverture du terminal…</Loading>
                ) : (
                  <>
                    <span className="muted">Aucun terminal ouvert.</span>
                    <button type="button" className="btn-cta" onClick={() => void terminals.add().catch(() => undefined)}>
                      Nouveau terminal
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <Empty title="Le terminal ne fonctionne que dans l’application de bureau." />
        )}
      </section>
      {menu}
    </div>
  )
}
