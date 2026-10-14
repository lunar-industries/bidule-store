import { Ghostty, type Terminal } from 'ghostty-web'

// What the tabs need of ghostty-web beyond its xterm.js-like API, in one place: it is pinned to one version
// (package.json), and what reaches inside it is checked before use.

// ghostty-web measures its cells once, with the font: it must be there before the first terminal.
let font: Promise<unknown> | null = null
export function ready(): Promise<unknown> {
  font ??= document.fonts.load('13px "JetBrains Mono"').catch(() => undefined)
  return font
}

/**
 * The emulator of one terminal: its own WebAssembly instance, loaded from the module ghostty-web embeds. ghostty-web
 * 0.4.0 shares one instance between its terminals by default, and reuses the memory a closed terminal leaves without
 * clearing it: the next one showed what was left there (a pane closed, then a split: coder/ghostty-web#138, #141). Its
 * own instance goes with the terminal; loading one costs a compilation of the module (about 400 KB) per terminal.
 */
export async function emulator(): Promise<Ghostty> {
  await ready()
  return Ghostty.load()
}

// A line of the buffer, as ghostty-web gives it (its type is not exported).
export type BufferLine = NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>

// A cell of the buffer: its column, and its line (0 is the oldest of the scrollback, the screen follows).
export type CellAt = { row: number; col: number }

type Selection = {
  selectionStart: { col: number; absoluteRow: number } | null
  selectionEnd: { col: number; absoluteRow: number } | null
  markCurrentSelectionDirty(): void
}

// The selection of a terminal, as ghostty-web keeps it; null if it is not what this version had.
function selectionOf(term: Terminal): Selection | null {
  const manager: unknown = Reflect.get(term, 'selectionManager')
  if (typeof manager !== 'object' || manager === null) return null
  if (!('selectionStart' in manager) || !('selectionEnd' in manager)) return null
  if (typeof Reflect.get(manager, 'markCurrentSelectionDirty') !== 'function') return null
  return manager as Selection
}

/**
 * Selects from one cell to another, both included. ghostty-web's own `select` and `selectAll` count the lines from
 * the top of the view where its selection counts them from the oldest of the scrollback: with a scrollback, they
 * select the wrong lines. Its selection is set here instead, and the rows it leaves and takes are drawn again.
 */
export function selectCells(term: Terminal, from: CellAt, to: CellAt): boolean {
  const selection = selectionOf(term)
  if (!selection) return false
  selection.markCurrentSelectionDirty()
  selection.selectionStart = { col: from.col, absoluteRow: from.row }
  selection.selectionEnd = { col: to.col, absoluteRow: to.row }
  selection.markCurrentSelectionDirty()
  return true
}

// Where the lines of the active screen start among those the selection counts: after the scrollback on the
// alternate screen (a full-screen program), whose lines ghostty-web's buffer numbers from 0.
export function rowOffset(term: Terminal): number {
  return term.buffer.active.type === 'alternate' ? term.getScrollbackLength() : 0
}
