// The tabs' order the user drags: pure, on any list.

// `list` with the item at `from` moved to `to` (indexes of the list as it is; `to` past the end puts it last).
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list]
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(to > from ? to - 1 : to, out.length)), 0, item)
  return out
}

// Where a drop lands: before the tab under the pointer, or after it when the pointer is past its middle.
export const dropIndex = (index: number, pointer: number, start: number, size: number) => (pointer > start + size / 2 ? index + 1 : index)

// The colours a tab can take (the theme's), none by default.
export const TAB_COLORS = ['coral', 'mint', 'butter', 'blue', 'pink2'] as const
export type TabColor = (typeof TAB_COLORS)[number]
