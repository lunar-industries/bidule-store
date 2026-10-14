// A tab split in two panes: side by side (`row`) or one above the other (`column`), the first pane taking `ratio` of
// the room. One level only: two panes per tab at most. Pure.

export type SplitDirection = 'row' | 'column'

// Neither pane gets smaller than this share of the room.
export const MIN_RATIO = 0.15
export const MAX_RATIO = 1 - MIN_RATIO
// How far an arrow key moves the boundary.
export const RATIO_STEP = 0.05

export const clampRatio = (ratio: number) => (Number.isFinite(ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) : 0.5)

// The ratio a pointer at `at` (along the split's axis) gives, the room starting at `start` and `size` long.
export function ratioAt(at: number, start: number, size: number): number {
  return size > 0 ? clampRatio((at - start) / size) : 0.5
}

/**
 * The boundary moved by a key of its handle: the arrows of its axis by a step (← ↑ smaller first pane, → ↓ larger),
 * Home and End to the ends. Null: not a key of this handle.
 */
export function ratioByKey(ratio: number, key: string, direction: SplitDirection): number | null {
  const [less, more] = direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  if (key === less) return clampRatio(ratio - RATIO_STEP)
  if (key === more) return clampRatio(ratio + RATIO_STEP)
  if (key === 'Home') return MIN_RATIO
  if (key === 'End') return MAX_RATIO
  return null
}

// The other pane of a split tab (0 or 1); the only one otherwise.
export const otherPane = (focused: number, panes: number) => (panes > 1 ? 1 - Math.min(1, Math.max(0, focused)) : 0)

export type SplitAction = 'split-row' | 'split-column' | 'other-pane'

/**
 * The split's keys, taken before the shell sees them: Ctrl+Shift+E splits side by side, Ctrl+Shift+O one above the
 * other (as in Terminator), Ctrl+Shift+an arrow goes to the other pane.
 */
export function splitAction(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey?: boolean }): SplitAction | null {
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null
  const key = e.key.toLowerCase()
  if (key === 'e') return 'split-row'
  if (key === 'o') return 'split-column'
  if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') return 'other-pane'
  return null
}
