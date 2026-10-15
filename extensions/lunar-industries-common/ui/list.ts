import { useRef, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { isMenuKey } from './menu.tsx'

/**
 * A list as a desktop app's (the rows of Conteneurs, Branches, the sessions of Claude): one stop of Tab for the whole
 * list, on its active row; the arrows, Home, End, Page Up and Page Down move between the rows and the focus follows;
 * Enter opens the row, Space ticks it, Delete removes it, the Menu key or Shift+F10 opens its menu. Each module keeps
 * which row is active (`active`, `setActive`): the hook only answers the keys and moves the focus.
 */
export type ListKeys = {
  // The rows' ids, in the order they are shown.
  ids: string[]
  // The row the list's stop of Tab is on; the first one when it is gone.
  active: string | null
  setActive: (id: string) => void
  onOpen?: (id: string) => void
  onToggle?: (id: string) => void
  onDelete?: (id: string) => void
  onMenu?: (id: string, e: ReactKeyboardEvent) => void
  // How many rows Page Up and Page Down move by.
  page?: number
}

export function useListKeys({ ids, active, setActive, onOpen, onToggle, onDelete, onMenu, page = 10 }: ListKeys) {
  const rows = useRef(new Map<string, HTMLElement>())
  const current = active !== null && ids.includes(active) ? active : (ids[0] ?? null)
  const go = (id: string | undefined) => {
    if (id === undefined) return
    setActive(id)
    rows.current.get(id)?.focus()
  }
  const onKeyDown = (id: string) => (e: ReactKeyboardEvent) => {
    // A key meant for a control inside the row (a button, a field) stays with it.
    if (e.target !== e.currentTarget) return
    const at = ids.indexOf(id)
    const moves: Record<string, () => string | undefined> = {
      ArrowDown: () => ids[Math.min(at + 1, ids.length - 1)],
      ArrowUp: () => ids[Math.max(at - 1, 0)],
      Home: () => ids[0],
      End: () => ids[ids.length - 1],
      PageDown: () => ids[Math.min(at + page, ids.length - 1)],
      PageUp: () => ids[Math.max(at - page, 0)],
    }
    if (moves[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      return go(moves[e.key]())
    }
    if (isMenuKey(e) && onMenu) return onMenu(id, e)
    const actions: Record<string, ((id: string) => void) | undefined> = {
      Enter: onOpen,
      ' ': onToggle,
      Delete: onDelete,
    }
    const action = actions[e.key]
    if (action && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      action(id)
    }
  }
  // What each row takes: its stop of Tab, its place among the rows, the keys.
  const rowProps = (id: string) => ({
    tabIndex: id === current ? 0 : -1,
    ref: (el: HTMLElement | null) => {
      if (el) rows.current.set(id, el)
      else rows.current.delete(id)
    },
    onFocus: (e: FocusEvent) => e.target === e.currentTarget && id !== active && setActive(id),
    onKeyDown: onKeyDown(id),
  })
  return { rowProps, focus: go }
}

/**
 * Ticking rows as a desktop app's: a click on a row's box ticks or unticks it alone; with Ctrl (⌘ on macOS) too; with
 * Shift, every row from the last one ticked (`anchor`) to this one takes the state of the last one. Pure: each module
 * keeps its ticks where it wants (Conteneurs keeps them between launches).
 */
export function nextTicks(
  ticked: ReadonlySet<string>,
  ids: string[],
  id: string,
  { shift, anchor }: { shift: boolean; anchor: string | null },
): { ticked: Set<string>; anchor: string } {
  const next = new Set(ticked)
  const from = anchor === null ? -1 : ids.indexOf(anchor)
  const to = ids.indexOf(id)
  if (shift && from >= 0 && to >= 0) {
    const on = anchor !== null && ticked.has(anchor)
    for (const row of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      if (on) next.add(row)
      else next.delete(row)
    }
    return { ticked: next, anchor: anchor ?? id }
  }
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return { ticked: next, anchor: id }
}

// Ctrl+A (⌘A on macOS) in a list: every row shown ticked, or none when they all were.
export function allTicks(ticked: ReadonlySet<string>, ids: string[]): Set<string> {
  return ids.every((id) => ticked.has(id)) ? new Set([...ticked].filter((id) => !ids.includes(id))) : new Set([...ticked, ...ids])
}
