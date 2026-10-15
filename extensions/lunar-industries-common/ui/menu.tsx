import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { errorMessage, react } from '@bidule/sdk'

/**
 * The menu the Lunar Industries modules share (a row's « ⋯ », its right click, the Menu key), as a desktop app's: the
 * arrows, Home and End move between the items, a letter goes to the next item it starts, Enter or a click runs one,
 * Escape and Tab close it, a click elsewhere too. It gives the focus back to what opened it, and stays inside the
 * window, measured once drawn. Built into each module's package with its interface: no module depends on this one at
 * run time.
 */

// An item: what it says, what it does. `disabled` keeps it in the menu, reachable but off, with the reason as its
// tooltip when it is a text; `shortcut` shows its keys on the right. `null` and `false` are left out, so that a menu
// is written with conditions inline.
export type MenuItem = {
  label: string
  run: () => unknown
  disabled?: boolean | string
  shortcut?: string
}
export type MenuEntry = MenuItem | 'separator' | null | false | undefined

// Where a menu opens: at the pointer, or under an element (above it when there is no room below), and what gets the
// focus back once it closes. `toggle`: opened from a button, which closes it when clicked again.
type Place = { x: number; y: number; flipY: number; opener: HTMLElement | null; toggle: boolean }

// The Menu key, or Shift+F10: they open the menu of what has the focus.
export const isMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')

const MARGIN = 8

const isItem = (entry: MenuEntry): entry is MenuItem => typeof entry === 'object' && entry !== null

export function Menu({
  entries,
  label,
  place,
  onClose,
}: {
  entries: MenuEntry[]
  label: string
  place: Place
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: place.x, top: place.y })
  // Separators only between items: none first, last, or twice in a row.
  const shown = entries
    .filter((e): e is MenuItem | 'separator' => e === 'separator' || isItem(e))
    .filter((e, i, all) => e !== 'separator' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'separator'))

  // Kept inside the window, measured once drawn: left of the pointer near the right edge, above it near the bottom.
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    let left = place.x
    let top = place.y
    if (left + rect.width > innerWidth - MARGIN) left = Math.max(MARGIN, innerWidth - rect.width - MARGIN)
    if (top + rect.height > innerHeight - MARGIN) top = Math.max(MARGIN, place.flipY - rect.height)
    setAt({ left, top })
  }, [place])

  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  useEffect(() => {
    items()[0]?.focus()
  }, [])

  // Closing gives the focus back to what opened the menu, unless the user clicked somewhere else.
  const close = useCallback(
    (refocus: boolean) => {
      onClose()
      if (refocus) place.opener?.focus()
    },
    [onClose, place.opener],
  )
  useEffect(() => {
    const away = (e: Event) => {
      const target = e.target instanceof Node ? e.target : null
      if (target && box.current?.contains(target)) return
      // A click on the button that opened it toggles it: its own click handler closes it.
      if (target && place.toggle && place.opener?.contains(target)) return
      close(false)
    }
    const leave = () => close(false)
    const scrolled = (e: Event) => e.target instanceof Node && !box.current?.contains(e.target) && close(false)
    addEventListener('pointerdown', away, true)
    addEventListener('blur', leave)
    addEventListener('resize', leave)
    addEventListener('scroll', scrolled, true)
    return () => {
      removeEventListener('pointerdown', away, true)
      removeEventListener('blur', leave)
      removeEventListener('resize', leave)
      removeEventListener('scroll', scrolled, true)
    }
  }, [close, place.opener, place.toggle])

  const move = (to: (at: number, count: number) => number) => {
    const list = items()
    if (!list.length) return
    const at = list.findIndex((item) => item === document.activeElement)
    list[(to(at, list.length) + list.length) % list.length]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move((at) => at + 1),
      ArrowUp: () => move((at) => (at < 0 ? -1 : at - 1)),
      Home: () => move(() => 0),
      End: () => move((_, count) => count - 1),
      Escape: () => close(true),
      Tab: () => close(true),
    }
    const key = keys[e.key]
    if (key) {
      e.preventDefault()
      e.stopPropagation()
      return key()
    }
    // A letter: the next item that starts with it.
    if (e.key.length === 1 && /\p{L}|\d/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const list = items()
      const at = list.findIndex((item) => item === document.activeElement)
      const letter = e.key.toLocaleLowerCase('fr')
      const next = [...list.slice(at + 1), ...list.slice(0, at + 1)].find((item) =>
        item.textContent?.trim().toLocaleLowerCase('fr').startsWith(letter),
      )
      next?.focus()
    }
  }
  const run = (item: MenuItem) => {
    if (item.disabled) return
    // The focus goes back first: a dialog the item opens takes it from there, and gives it back there.
    close(true)
    void Promise.resolve()
      .then(item.run)
      .catch((err: unknown) => react('panic', errorMessage(err), errorMessage(err)))
  }

  // In the page's body: an ancestor moved by a transform (the banner's edge) would offset a fixed menu inside it.
  return createPortal(
    <div
      ref={box}
      className="menu floating"
      role="menu"
      aria-label={label}
      style={{ left: at.left, top: at.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {shown.map((entry, i) =>
        entry === 'separator' ? (
          <hr key={`sep-${i}`} className="menu-sep" />
        ) : (
          <button
            key={`${i}-${entry.label}`}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={entry.shortcut ? 'menu-item menu-shortcut' : 'menu-item'}
            aria-disabled={entry.disabled ? true : undefined}
            title={typeof entry.disabled === 'string' ? entry.disabled : undefined}
            onClick={() => run(entry)}
          >
            {entry.label}
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

/**
 * A menu to open from a row or a button: `[menu, open]`, where `menu` goes anywhere in the component (it draws in the
 * page's body) and `open` takes what opens it: a right click (at the pointer), a key (the Menu key or Shift+F10, under
 * the element that has the focus) or an element (a « ⋯ » button, under it). Opening it again from the same button
 * closes it.
 */
export function useMenu(): [
  ReactNode,
  (source: MouseEvent | KeyboardEvent | HTMLElement, entries: MenuEntry[], label: string) => void,
] {
  const [open, setOpen] = useState<{ entries: MenuEntry[]; label: string; place: Place } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const show = (source: MouseEvent | KeyboardEvent | HTMLElement, entries: MenuEntry[], label: string) => {
    let place: Place
    if (source instanceof HTMLElement) {
      if (open?.place.opener === source) return setOpen(null)
      const rect = source.getBoundingClientRect()
      place = { x: rect.left, y: rect.bottom + 4, flipY: rect.top - 4, opener: source, toggle: true }
    } else {
      source.preventDefault()
      source.stopPropagation()
      // What was clicked or had the key: the row, which gets the focus back.
      const opener = source.currentTarget instanceof HTMLElement ? source.currentTarget : null
      if ('clientX' in source && source.type === 'contextmenu') {
        place = { x: source.clientX, y: source.clientY, flipY: source.clientY, opener, toggle: false }
      } else {
        const rect = opener?.getBoundingClientRect()
        const y = (rect?.bottom ?? 0) + 4
        place = { x: rect?.left ?? 0, y, flipY: (rect?.top ?? 0) - 4, opener, toggle: false }
      }
    }
    setOpen({ entries, label, place })
  }
  const menu = open && <Menu entries={open.entries} label={open.label} place={open.place} onClose={close} />
  return [menu, show]
}
