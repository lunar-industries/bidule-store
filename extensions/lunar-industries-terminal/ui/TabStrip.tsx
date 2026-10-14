import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TerminalMark } from '../contract.ts'
import { bannerCap, roomBeside, tabsFit } from './fit.ts'
import { dropIndex } from './order.ts'
import { renameTab, TabMenu } from './TabMenu.tsx'
import { terminals, type TerminalTab } from './tabs.ts'

// A tab dragged to another place (its key), as the drag carries it.
const TAB_DRAG = 'application/x-bidule-lterm-tab'

// A tab's colour, as a class (the stylesheet gives each its theme colour).
const colorOf = (t: TerminalTab) => (t.color ? ` coloured color-${t.color}` : '')

const px = (value: string) => Number.parseFloat(value) || 0

// Where the strip may spread: in the focus bar, what the other tools leave; on the banner's edge, up to its cap.
function roomOf(root: HTMLElement): number {
  const row = root.parentElement
  if (row?.classList.contains('focus-tools')) {
    const others = [...row.children].filter((c) => c !== root).map((c) => c.getBoundingClientRect().width)
    return roomBeside(row.clientWidth, others, px(getComputedStyle(row).columnGap))
  }
  return bannerCap(innerWidth)
}

/**
 * The terminal's tabs: side by side while they fit (each with its ×), else one pill naming the active tab, which
 * opens the list of them all (go to one, close one, open a new one). What fits is measured — the tabs' own widths,
 * drawn out of sight, against the room the strip has — again whenever the window, the bar or the tabs change.
 */
export function TabStrip() {
  // The tabs change in place (titles, the active one): drawn as they are.
  'use no memo'
  useSyncExternalStore(terminals.subscribe, terminals.version)
  const root = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [listed, setListed] = useState(false)
  const [open, setOpen] = useState(false)
  const [room, setRoom] = useState(() => bannerCap(innerWidth))
  const [tabMenu, setTabMenu] = useState<{ tab: TerminalTab; x: number; y: number } | null>(null)
  // Where a dragged tab would land (a gap between tabs), drawn as a mark.
  const [dropAt, setDropAt] = useState<number | null>(null)
  const { tabs, active } = terminals

  // Dragging a tab to another place, along the row (x) or down the list (y).
  const dragProps = (t: TerminalTab, index: number, axis: 'x' | 'y') => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(TAB_DRAG, String(t.key))
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TAB_DRAG)) return
      e.preventDefault()
      const box = e.currentTarget.getBoundingClientRect()
      setDropAt(axis === 'x' ? dropIndex(index, e.clientX, box.left, box.width) : dropIndex(index, e.clientY, box.top, box.height))
    },
    onDragLeave: () => setDropAt(null),
    onDrop: (e: React.DragEvent) => {
      const key = Number(e.dataTransfer.getData(TAB_DRAG))
      const dragged = tabs.find((x) => x.key === key)
      e.preventDefault()
      if (dragged && dropAt !== null) terminals.move(dragged, dropAt)
      setDropAt(null)
    },
    onDragEnd: () => setDropAt(null),
  })
  const mark = (index: number) => (dropAt === index ? ' drop-before' : dropAt === index + 1 && index === tabs.length - 1 ? ' drop-after' : '')
  const openMenu = (t: TerminalTab) => (e: React.MouseEvent) => {
    e.preventDefault()
    setTabMenu({ tab: t, x: e.clientX, y: e.clientY })
  }

  // The room, when the window or the row the strip sits in changes size.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const update = () => setRoom(roomOf(el))
    update()
    const watched = new ResizeObserver(update)
    if (el.parentElement) watched.observe(el.parentElement)
    addEventListener('resize', update)
    return () => {
      watched.disconnect()
      removeEventListener('resize', update)
    }
  }, [])

  // Side by side or in a list: the tabs as drawn out of sight, against that room. At every render on purpose: the
  // widths follow everything a tab shows (title, colour, icons), and the same answer renders nothing again.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const strip = measure.current
    if (!strip) return
    const style = getComputedStyle(strip)
    const widths = [...strip.children].map((c) => c.getBoundingClientRect().width)
    const fits = tabsFit(widths, room, px(style.columnGap), px(style.paddingLeft) + px(style.paddingRight))
    setListed(!fits)
  })

  // A new or chosen tab is always in sight.
  useEffect(() => {
    if (!listed) root.current?.querySelector('.lterm-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, listed])

  // The list closes on a click elsewhere or Escape; the arrows go from one item to the next.
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])]
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
    addEventListener('mousedown', away)
    addEventListener('keydown', keys, true)
    return () => {
      removeEventListener('mousedown', away)
      removeEventListener('keydown', keys, true)
    }
  }, [open])
  useEffect(() => {
    if (!listed) setOpen(false)
  }, [listed])

  const choose = (tab: TerminalTab) => {
    terminals.select(tab)
    setOpen(false)
  }

  return (
    <div ref={root} className="lterm-switch">
      {/* The row, out of sight, as wide as it would be: what decides between the row and the list. */}
      <div ref={measure} className="row lterm-tabs lterm-tabs-measure" aria-hidden="true" inert>
        {tabs.map((t) => (
          <div key={t.key} className={`row lterm-tab${t === active ? ' active' : ''}`}>
            {t.split ? (
              <PaneTitles tab={t} />
            ) : (
              <button type="button" className="lterm-tab-title ellipsis" tabIndex={-1}>
                <TabMark tab={t} />
                {t.label}
              </button>
            )}
            <button type="button" className="lterm-tab-close" tabIndex={-1}>
              ×
            </button>
          </div>
        ))}
      </div>

      {!listed ? (
        <div className="row lterm-tabs" role="tablist" aria-label="Terminaux" style={{ maxWidth: room }}>
          {tabs.map((t, i) => (
            <div
              key={t.key}
              className={`row lterm-tab${t === active ? ' active' : ''}${colorOf(t)}${mark(i)}`}
              {...dragProps(t, i, 'x')}
              onContextMenu={openMenu(t)}
            >
              {t.split ? (
                <PaneTitles tab={t} live />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className="lterm-tab-title ellipsis"
                  aria-selected={t === active}
                  title={`${t.label} — double clic pour renommer`}
                  onClick={() => terminals.select(t)}
                  onDoubleClick={() => renameTab(t)}
                  onAuxClick={(e) => e.button === 1 && terminals.close(t)}
                >
                  <TabMark tab={t} />
                  {t.label}
                </button>
              )}
              <button type="button" className="lterm-tab-close" aria-label={`Fermer ${t.heading}`} onClick={() => terminals.close(t)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="row lterm-switch-button"
            aria-haspopup="menu"
            aria-expanded={open}
            title={`${tabs.length} terminaux`}
            onClick={() => setOpen(!open)}
          >
            {tabs.some((t) => terminals.markOf(t)?.state === 'waiting') && <span className="lterm-mark waiting" aria-label="Un terminal attend ta réponse" />}
            <span className="ellipsis">{active?.heading ?? 'Terminaux'}</span>
            <span className="lterm-switch-count">
              {active ? tabs.indexOf(active) + 1 : 0}/{tabs.length}
            </span>
            <span aria-hidden="true">▾</span>
          </button>
          {open && (
            <div ref={menu} className="menu lterm-switch-menu" role="menu" aria-label="Terminaux">
              {tabs.map((t, i) => (
                <div
                  key={t.key}
                  className={`row lterm-switch-item${colorOf(t)}${mark(i)}`}
                      {...dragProps(t, i, 'y')}
                  onContextMenu={openMenu(t)}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={t === active}
                    className="menu-item grow ellipsis"
                    title={t.heading}
                    onClick={() => choose(t)}
                    onDoubleClick={() => renameTab(t)}
                  >
                    <TabMark tab={t} />
                    {t.heading}
                  </button>
                  <button type="button" className="lterm-tab-close" aria-label={`Fermer ${t.heading}`} onClick={() => terminals.close(t)}>
                    ×
                  </button>
                </div>
              ))}
              <hr className="menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="menu-item menu-shortcut"
                onClick={() => {
                  setOpen(false)
                  void terminals.add()
                }}
              >
                Nouveau terminal <kbd>Ctrl+Maj+T</kbd>
              </button>
            </div>
          )}
        </>
      )}
      {tabMenu && <TabMenu {...tabMenu} close={() => setTabMenu(null)} />}
    </div>
  )
}

/**
 * A split tab in the strip: each of its terminals by its title, side by side in the tab's pill (its name first when the
 * user gave it one). A click goes to that terminal, the one with the focus stands out, a middle click closes it alone,
 * a double click renames the tab. `live` false: the copy drawn out of sight to be measured.
 */
function PaneTitles({ tab, live = false }: { tab: TerminalTab; live?: boolean }) {
  const shown = terminals.active === tab
  return (
    <div className="row lterm-tab-panes" role={live ? 'tab' : undefined} aria-selected={live ? shown : undefined}>
      {tab.name && (
        <span className="lterm-tab-name ellipsis">
          <TabMark tab={tab} />
          {tab.name}
        </span>
      )}
      {tab.panes.map((pane, i) => (
        <button
          key={i}
          type="button"
          className={`lterm-tab-title lterm-tab-pane ellipsis${shown && i === tab.focused ? ' focused' : ''}`}
          tabIndex={live ? undefined : -1}
          aria-label={live ? `${pane.title}, terminal ${i + 1} sur ${tab.panes.length}` : undefined}
          title={live ? `${pane.title} — clic du milieu pour fermer ce terminal` : undefined}
          onClick={
            live
              ? () => {
                  terminals.select(tab)
                  terminals.focusPane(i, tab)
                }
              : undefined
          }
          onDoubleClick={live ? () => renameTab(tab) : undefined}
          onAuxClick={live ? (e) => e.button === 1 && terminals.closePane(tab, pane) : undefined}
        >
          {i === 0 && !tab.name && <TabMark tab={tab} />}
          {pane.title}
        </button>
      ))}
    </div>
  )
}

const MARK_LABELS: Record<TerminalMark, string> = {
  working: 'Travaille',
  waiting: 'Attend ta réponse',
  done: 'A terminé',
  failed: 'S’est arrêté sur une erreur',
}

// What a session in the tab's folder is doing, put there by another extension (Claude Code waits…): a dot.
function TabMark({ tab }: { tab: TerminalTab }) {
  const mark = terminals.markOf(tab)
  if (!mark) return null
  const label = mark.label ?? MARK_LABELS[mark.state]
  return <span className={`lterm-mark ${mark.state}`} role="img" aria-label={label} title={label} />
}
