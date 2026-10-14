import { FitAddon, Terminal, type Ghostty, type ILink } from 'ghostty-web'
import type { TerminalBridge, TerminalTarget, ShellPlace } from '@bidule/api/bridge'
import { isPaletteKey, navigate, parseWslPath, react, readTasks } from '@bidule/sdk'
import type { TerminalMark } from '../contract.ts'
import { findMatches, pickMatch, viewFor, type Match } from './find.ts'
import { emulator, ready, rowOffset, selectCells, type BufferLine } from './ghostty.ts'
import { CommandTracker, commandLineOf, folderOf, LONG_COMMAND_MS, noticeOf, type Finished } from './integration.ts'
import { keySequence, pageScroll } from './keys.ts'
import { findFileLines, findReviews, findTaskRefs, findUrls } from './links.ts'
import { moved, type TabColor } from './order.ts'
import { OscReader } from './osc.ts'
import { PAGE } from './page.ts'
import { dropText, type ShellKind } from './paths.ts'
import { clampRatio, otherPane, ratioAt, ratioByKey, splitAction, type SplitDirection } from './split.ts'
import { themeNow } from './theme.ts'

// Taken from the official terminal (extensions/terminal/ui/tabs.ts), itself from quack-board; drawn by ghostty-web
// instead of xterm.js.
export type TerminalState = 'starting' | 'running' | 'exited'

const bridge = (): TerminalBridge | undefined => (window as { bidule?: { terminal?: TerminalBridge } }).bidule?.terminal
const platform = (): string | undefined => (window as { bidule?: { platform?: string } }).bidule?.platform

// The user's tasks by reference (ID-123 → its page), read from the board at most once a minute: what a reference in a
// terminal opens.
let board: { at: number; refs: Map<string, string>; urls: Map<string, string | null> } | null = null
async function taskRefs(): Promise<NonNullable<typeof board>> {
  if (board && Date.now() - board.at < 60_000) return board
  const refs = new Map<string, string>()
  const urls = new Map<string, string | null>()
  try {
    const read = await readTasks()
    for (const t of read.source === null ? [] : read.tasks) {
      if (!t.ref) continue
      refs.set(t.ref.toUpperCase(), t.ref)
      urls.set(t.ref, t.url)
    }
  } catch (err) {
    // The tasks could not be read: no reference is a link until the next reading.
    console.warn('Terminal : les tâches ne se lisent pas, leurs références ne sont pas des liens', err)
  }
  board = { at: Date.now(), refs, urls }
  return board
}

// A line of the terminal as text, with the column of each character (a wide one takes two cells).
function lineText(line: BufferLine, cols: number): { text: string; colOf: number[] } {
  let text = ''
  const colOf: number[] = []
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x)
    if (!cell) break
    if (cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    for (let i = 0; i < chars.length; i++) colOf.push(x)
    text += chars
  }
  return { text, colOf }
}

// A setting of the terminal, read when it is needed: changed in the settings, it holds from the next time.
// Unreadable, undefined (the caller's default).
async function setting(key: string): Promise<unknown> {
  try {
    const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } })
    return ((await res.json()) as { values?: Record<string, unknown> }).values?.[key]
  } catch {
    return undefined
  }
}

// Where a new tab's shell runs: the tools' environment (where git runs; Réglages › Général), asked from the API when the
// tab starts: WSL or PowerShell on Windows, a toolbox on Linux. Null for the host, or when unknown (no answer: on
// Windows, the main process picks WSL when it is installed).
async function askShellPlace(): Promise<ShellPlace | null> {
  try {
    const res = await fetch('/api/about', { headers: { Accept: 'application/json' } })
    const about: unknown = await res.json()
    const env: unknown = typeof about === 'object' && about !== null ? Reflect.get(about, 'environment') : null
    if (typeof env !== 'object' || env === null) return null
    const kind: unknown = Reflect.get(env, 'kind')
    const distro: unknown = Reflect.get(env, 'distro')
    const toolbox: unknown = Reflect.get(env, 'toolbox')
    if (kind === 'powershell') return { kind: 'powershell' }
    if (kind === 'toolbox' && typeof toolbox === 'string' && toolbox) return { kind: 'toolbox', name: toolbox }
    return kind === 'wsl' && typeof distro === 'string' && distro ? { kind: 'wsl', distro } : null
  } catch {
    return null
  }
}

// Whether visiting the page without a tab opens one (setting `lunar-industries-terminal.onVisit`: `open` unless `nothing` is chosen).
async function openOnVisit(): Promise<boolean> {
  return (await setting('lunar-industries-terminal.onVisit')) !== 'nothing'
}

// What the search found in a pane: the matches of its text, and the one shown (-1: none yet).
export type Found = { query: string; caseSensitive: boolean; matches: Match[]; index: number }

/**
 * One shell of a tab and its ghostty-web view (`pty`, null once ended): a tab has one, or two once split. Its view is
 * opened in its box when it is made, on the page or not: ghostty-web writes nothing to a terminal not opened yet.
 */
export class TerminalPane {
  title: string
  state: TerminalState = 'starting'
  exitCode: number | null = null
  pty: number | null = null
  readonly fit = new FitAddon()
  // Where its shell runs, asked when it started (the tools' environment); null for the host or when not known.
  shellPlace: ShellPlace | null = null
  // Where its shell is (OSC 7, from the shell integration): its links resolve from there. Null without integration.
  cwd: string | null = null
  // Its commands, from the marks of the shell integration.
  readonly commands = new CommandTracker()
  // The marks of the shell integration, read in its output (ghostty-web does not hand them over).
  readonly osc = new OscReader()
  // The search in its lines, while the search bar is open.
  found: Found | null = null
  // Where its view sits: the tab lays its panes' boxes out (one, or two with a handle between).
  readonly box = document.createElement('div')

  constructor(
    readonly tab: TerminalTab,
    readonly fallbackTitle: string,
    readonly term: Terminal,
    // A command an extension prepared (a container's shell, Claude Code on a task), instead of the user's shell.
    readonly target?: TerminalTarget,
    // The folder it works in (a task's worktrees).
    readonly folder?: string,
  ) {
    this.title = fallbackTitle
    this.box.className = 'lterm-pane'
    term.loadAddon(this.fit)
    term.open(this.box)
  }

  // The WSL distribution its paths are of (`default`: the default one), or null for this machine's.
  get wsl(): string | null {
    if (this.shell !== 'wsl') return null
    return (this.folder && parseWslPath(this.folder)?.distro) || 'default'
  }

  // The folder links and scripts are read from: its shell's, else the one it was opened in (as its shell sees it).
  get place(): string | null {
    if (this.cwd) return this.cwd
    if (!this.folder) return null
    return this.wsl ? (parseWslPath(this.folder)?.linux ?? this.folder) : this.folder
  }

  /**
   * The shell behind the pane, for a path dropped on it: a POSIX shell, except on Windows, where it is WSL (a
   * prepared command, the environment, or WSL installed when it is not known) or PowerShell (the environment, or what
   * its title says).
   */
  get shell(): ShellKind {
    if (platform() !== 'win32') return 'posix'
    if (this.target || this.shellPlace?.kind === 'wsl') return 'wsl'
    if (this.shellPlace?.kind === 'powershell' || /powershell|pwsh/i.test(this.title)) return 'powershell'
    return 'wsl'
  }
}

/**
 * One tab: its panes (one, or two once split: side by side or stacked, the first taking `ratio` of the room) and the
 * one with the focus. What acts on a tab's shell (copy, paste, search, a dropped file, links) acts on that pane: the
 * getters below are its.
 */
export class TerminalTab {
  // What the user named and coloured the tab (kept while the app runs); its title is the shell's otherwise.
  name: string | null = null
  color: TabColor | null = null
  // A command that ended out of sight (done or failed): a mark on the tab until it is seen.
  notice: { state: TerminalMark; label: string } | null = null
  panes: TerminalPane[] = []
  focused = 0
  direction: SplitDirection = 'row'
  ratio = 0.5

  constructor(
    readonly key: number,
    readonly fallbackTitle: string,
    // A command an extension prepared, instead of the user's shell (its first pane's).
    readonly target?: TerminalTarget,
    // The folder it works in (a task's worktrees): the Claude page shows which ones have a tab.
    readonly folder?: string,
    // Kept once its command ended (a script: its output stays to be read), instead of closing.
    readonly keep = false,
  ) {}

  // The pane with the focus.
  get pane(): TerminalPane {
    return this.panes[this.focused] ?? this.panes[0]
  }

  get split(): boolean {
    return this.panes.length > 1
  }

  // What the tab is called: the user's name for it, else its first shell's title.
  get label(): string {
    return this.name ?? this.panes[0]?.title ?? this.fallbackTitle
  }

  // What the strip's list says of it: the user's name for it, else the title of each of its shells (two once split).
  get heading(): string {
    return this.name ?? (this.panes.map((p) => p.title).join(' │ ') || this.fallbackTitle)
  }

  get title(): string {
    return this.pane.title
  }
  get term(): Terminal {
    return this.pane.term
  }
  get state(): TerminalState {
    return this.pane.state
  }
  get exitCode(): number | null {
    return this.pane.exitCode
  }
  get cwd(): string | null {
    return this.pane.cwd
  }
  get wsl(): string | null {
    return this.pane.wsl
  }
  get place(): string | null {
    return this.pane.place
  }
  get shell(): ShellKind {
    return this.pane.shell
  }
}

/**
 * The terminal's tabs outlive the page: leaving for the Kanban and coming back finds the same shells, their output
 * and scrollback. Only the active tab's view sits in the page; the others wait detached (a view is opened once, in its
 * pane's box, and the box is moved, never re-made).
 */
export class TerminalTabs {
  readonly available = Boolean(bridge())
  tabs: TerminalTab[] = []
  active: TerminalTab | null = null

  #host: HTMLElement | null = null
  #lastKey = 0
  #listening = false
  #listeners = new Set<() => void>()
  #version = 0
  // The search bar is open (Ctrl+Shift+F).
  searching = false
  // Why no terminal can be made (the page refuses WebAssembly…): said by the page in place of its button.
  problem: string | null = null

  // An emulator for a new pane; what keeps it from loading is kept for the page, then thrown.
  async #emulator(): Promise<Ghostty> {
    try {
      const ghostty = await emulator()
      this.problem = null
      return ghostty
    } catch (err) {
      this.problem = (err as Error).message
      this.#changed()
      throw err
    }
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  version = () => this.#version
  #changed() {
    this.#version++
    this.#listeners.forEach((l) => l())
  }

  // The page shows the terminal in `host`: the active tab, or a first one unless the settings say otherwise (the
  // page then offers its « Nouveau terminal » button).
  async attach(host: HTMLElement): Promise<void> {
    this.#host = host
    this.#listen()
    // The font first (ghostty-web measures its cells once).
    await ready()
    if (this.#host !== host) return
    if (this.active) this.select(this.active)
    // The setting is read after the font: a tab opened meanwhile (the button, another page) is not doubled, nor the
    // one a visit is already opening (the page attached twice in a row: its emulator loads meanwhile).
    else if ((await openOnVisit()) && this.#host === host && !this.active && !this.#visiting) {
      this.#visiting = true
      // A problem is said by the page (`problem`), not thrown at nobody.
      await this.add()
        .catch(() => undefined)
        .finally(() => (this.#visiting = false))
    }
  }
  #visiting = false

  detach(): void {
    this.#host = null
  }

  // A new tab, with the user's shell or `target`. Opened from another page, it shows once the Terminal page is open
  // (its shell already runs, and its output is kept).
  async add(target?: TerminalTarget, title?: string, folder?: string, options: { keep?: boolean } = {}): Promise<void> {
    this.#listen()
    const ghostty = await this.#emulator()
    const key = ++this.#lastKey
    const tab = new TerminalTab(key, title ?? `Terminal ${key}`, target, folder, options.keep)
    const pane = this.#newPane(ghostty, tab, tab.fallbackTitle, target, folder)
    tab.panes = [pane]
    this.tabs = [...this.tabs, tab]
    this.select(tab)
    await this.start(tab, pane)
  }

  // A pane of the tab, on its own emulator: its view, wired to its shell and to the shell integration.
  #newPane(ghostty: Ghostty, tab: TerminalTab, title: string, target?: TerminalTarget, folder?: string): TerminalPane {
    const pane = new TerminalPane(tab, title, this.#makeTerm(ghostty), target, folder)
    this.#integrate(pane)
    pane.term.onTitleChange((t) => {
      pane.title = t.trim() || pane.fallbackTitle
      this.#changed()
    })
    pane.term.onData((data) => pane.pty !== null && bridge()?.write(pane.pty, data))
    pane.term.onResize(({ cols, rows }) => pane.pty !== null && bridge()?.resize(pane.pty, cols, rows))
    // A click or the keyboard in a pane gives it the focus: what acts on the tab acts on it.
    pane.box.addEventListener('focusin', () => this.focusPane(tab.panes.indexOf(pane), tab, false))
    return pane
  }

  // Puts the tab's view in the page, sized to it.
  select(tab: TerminalTab): void {
    this.active = tab
    // Seen: the mark of a command that ended out of sight goes.
    if (this.#host) tab.notice = null
    this.#changed()
    if (!this.#host) return
    this.#layout(tab)
    this.fit()
    tab.term.focus()
  }

  // The tab's panes in the page: its one view, or both with the handle between; each view opened once, then moved.
  #layout(tab: TerminalTab): void {
    const host = this.#host
    if (!host) return
    if (!tab.split) host.replaceChildren(tab.panes[0].box)
    else {
      const { el, handle } = this.#splitOf(tab)
      el.className = `lterm-split ${tab.direction}`
      el.replaceChildren(tab.panes[0].box, handle, tab.panes[1].box)
      handle.setAttribute('aria-orientation', tab.direction === 'row' ? 'vertical' : 'horizontal')
      this.#applyRatio(tab)
      host.replaceChildren(el)
    }
    tab.panes.forEach((pane, i) => {
      pane.box.classList.toggle('focused', tab.split && i === tab.focused)
    })
  }

  // The frame of a split tab and the handle between its panes (made once, kept with the tab).
  #splits = new WeakMap<TerminalTab, { el: HTMLDivElement; handle: HTMLDivElement }>()
  #splitOf(tab: TerminalTab): { el: HTMLDivElement; handle: HTMLDivElement } {
    const known = this.#splits.get(tab)
    if (known) return known
    const el = document.createElement('div')
    const handle = document.createElement('div')
    handle.className = 'lterm-split-handle'
    handle.tabIndex = 0
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-label', 'Séparation des volets')
    handle.setAttribute('aria-valuemin', '15')
    handle.setAttribute('aria-valuemax', '85')
    // Dragged: the boundary follows the pointer; the shells are told their new size once per frame.
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      const move = (m: PointerEvent) => {
        const box = el.getBoundingClientRect()
        const row = tab.direction === 'row'
        this.setRatio(row ? ratioAt(m.clientX, box.left, box.width) : ratioAt(m.clientY, box.top, box.height), tab)
      }
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        tab.term.focus()
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    })
    handle.addEventListener('keydown', (e) => {
      const next = ratioByKey(tab.ratio, e.key, tab.direction)
      if (next === null) return
      e.preventDefault()
      this.setRatio(next, tab)
    })
    const made = { el, handle }
    this.#splits.set(tab, made)
    return made
  }

  #applyRatio(tab: TerminalTab): void {
    const made = this.#splits.get(tab)
    if (!tab.split || !made) return
    tab.panes[0].box.style.flex = `${tab.ratio} 1 0`
    tab.panes[1].box.style.flex = `${1 - tab.ratio} 1 0`
    made.handle.setAttribute('aria-valuenow', String(Math.round(tab.ratio * 100)))
  }

  #fitFrame = 0
  // The boundary of a split tab (the first pane's share of the room, kept within bounds).
  setRatio(ratio: number, tab = this.active): void {
    if (!tab?.split) return
    tab.ratio = clampRatio(ratio)
    this.#applyRatio(tab)
    cancelAnimationFrame(this.#fitFrame)
    this.#fitFrame = requestAnimationFrame(() => this.fit())
  }

  /**
   * Splits the tab: a second pane with the user's shell, side by side (`row`) or stacked (`column`), which takes the
   * focus. Already split, the tab only turns the other way: two panes at most.
   */
  async split(direction: SplitDirection, tab = this.active): Promise<void> {
    if (!tab) return
    tab.direction = direction
    if (tab.split) {
      if (this.active === tab) this.#layout(tab)
      this.fit()
      tab.term.focus()
      this.#changed()
      return
    }
    const ghostty = await this.#emulator()
    // Split meanwhile (the keys pressed twice), or closed: nothing more to make.
    if (tab.split || !this.tabs.includes(tab)) return
    tab.ratio = 0.5
    const pane = this.#newPane(ghostty, tab, `${tab.fallbackTitle} · 2`)
    tab.panes = [...tab.panes, pane]
    tab.focused = 1
    if (this.active === tab) this.#layout(tab)
    this.fit()
    this.#changed()
    await this.start(tab, pane)
  }

  // Gives the focus to a pane of the tab (the other one by the keys, or a click in it).
  focusPane(index: number, tab = this.active, focusView = true): void {
    if (!tab || index < 0 || index >= tab.panes.length) return
    const moved = tab.focused !== index
    tab.focused = index
    tab.panes.forEach((pane, i) => pane.box.classList.toggle('focused', tab.split && i === index))
    if (focusView) tab.pane.term.focus()
    if (moved) this.#changed()
  }

  // Ends a pane's shell and removes it: the tab goes back to one pane; its last pane closes the tab.
  closePane(tab: TerminalTab, pane: TerminalPane = tab.pane): void {
    if (!tab.split) return this.close(tab)
    if (pane.pty !== null) bridge()?.close(pane.pty)
    pane.pty = null
    pane.term.dispose()
    pane.box.remove()
    tab.panes = tab.panes.filter((p) => p !== pane)
    tab.focused = 0
    tab.panes[0].box.style.flex = ''
    tab.panes[0].box.classList.remove('focused')
    if (this.active === tab) {
      this.#layout(tab)
      this.fit()
      tab.term.focus()
    }
    this.#changed()
  }

  // A shell for a pane of the tab (the one with the focus): its first, or a new one after the previous ended (exit,
  // Ctrl+D).
  async start(tab: TerminalTab, pane: TerminalPane = tab.pane): Promise<void> {
    const b = bridge()
    if (!b || pane.pty !== null) return
    // Started again: the screen and the scrollback start empty (ESC c, a full reset). ghostty-web's own reset() makes
    // a new emulator that its selection does not follow.
    if (pane.state === 'exited') pane.term.write('\x1bc')
    pane.state = 'starting'
    pane.exitCode = null
    this.#changed()
    try {
      if (!pane.target) pane.shellPlace = await askShellPlace()
      pane.pty = pane.target
        ? await b.open(pane.term.cols, pane.term.rows, pane.target)
        : await b.open(pane.term.cols, pane.term.rows, undefined, pane.shellPlace ?? undefined)
    } catch (err) {
      // What could not start (a command missing, an expired session) is said in the pane, which can be restarted.
      const message = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      pane.term.write(`\x1b[31m${message}\x1b[0m\r\n`)
      pane.state = 'exited'
      this.#changed()
      return
    }
    pane.state = 'running'
    this.#changed()
    if (this.active === tab && tab.pane === pane) pane.term.focus()
  }

  // Ends the tab's shells and removes it; the neighbour takes its place.
  close(tab: TerminalTab): void {
    const index = this.tabs.indexOf(tab)
    if (index < 0) return
    for (const pane of tab.panes) {
      if (pane.pty !== null) bridge()?.close(pane.pty)
      pane.pty = null
      pane.term.dispose()
    }
    const rest = this.tabs.filter((t) => t !== tab)
    this.tabs = rest
    if (this.active === tab) {
      const next = rest[Math.min(index, rest.length - 1)]
      if (next) this.select(next)
      else {
        this.active = null
        this.#host?.replaceChildren()
      }
    }
    this.#changed()
  }

  // The user's name for the tab (empty: back to the shell's title), and its colour (null: none).
  rename(tab: TerminalTab, name: string): void {
    tab.name = name.trim() || null
    this.#changed()
  }

  recolor(tab: TerminalTab, color: TabColor | null): void {
    tab.color = color
    this.#changed()
  }

  // Puts the tab at `to` (a gap of the list as it is: 0 first, the length last).
  move(tab: TerminalTab, to: number): void {
    const from = this.tabs.indexOf(tab)
    if (from < 0) return
    this.tabs = moved(this.tabs, from, to)
    this.#changed()
  }

  // Files dropped on the tab: their paths at the prompt, quoted for its shell.
  drop(paths: string[], tab = this.active): void {
    const text = tab ? dropText(paths, tab.shell) : ''
    if (!tab || !text) return
    tab.term.paste(text)
    tab.term.focus()
  }

  // Searching the active tab's lines (the scrollback, then the screen); the match shown is selected.
  openSearch(): void {
    this.searching = true
    this.#changed()
  }

  closeSearch(): void {
    this.searching = false
    for (const tab of this.tabs)
      for (const pane of tab.panes) {
        if (pane.found && pane.found.index >= 0) pane.term.clearSelection()
        pane.found = null
      }
    this.active?.term.focus()
    this.#changed()
  }

  /**
   * Shows the next match of `text` in the tab's pane with the focus (`backwards`: the previous one), scrolled into
   * sight and selected; `typed` (the text just changed) stays on the match shown while it still fits. The lines are
   * read again each time: the shell may have written meanwhile. False without any match.
   */
  find(text: string, options: { caseSensitive: boolean; backwards?: boolean; typed?: boolean }, tab = this.active): boolean {
    const pane = tab?.pane
    if (!pane) return false
    const term = pane.term
    const shown = pane.found && pane.found.index >= 0 ? pane.found.matches[pane.found.index] : null
    if (!text) {
      if (shown) term.clearSelection()
      pane.found = null
      this.#changed()
      return false
    }
    const buffer = term.buffer.active
    const lines: { text: string; colOf: number[] }[] = []
    for (let y = 0; y < buffer.length; y++) {
      const line = buffer.getLine(y)
      lines.push(line ? lineText(line, term.cols) : { text: '', colOf: [] })
    }
    const matches = findMatches(
      lines.map((l) => l.text),
      text,
      options.caseSensitive,
    )
    // Without a match shown yet, from the top of the view.
    const top = buffer.type === 'alternate' ? 0 : term.getScrollbackLength() - Math.floor(term.getViewportY())
    const index = pickMatch(matches, shown ?? { row: top, start: -1 }, { backwards: options.backwards, stay: options.typed })
    pane.found = { query: text, caseSensitive: options.caseSensitive, matches, index }
    if (index >= 0) this.#show(term, matches[index], lines[matches[index].row].colOf)
    else if (shown) term.clearSelection()
    this.#changed()
    return index >= 0
  }

  // A match of the search, scrolled into sight (on the normal screen: the other one does not scroll) and selected.
  #show(term: Terminal, match: Match, colOf: number[]): void {
    if (term.buffer.active.type === 'normal') {
      const now = Math.floor(term.getViewportY())
      const next = viewFor(match.row, now, term.getScrollbackLength(), term.rows)
      if (next !== now) term.scrollLines(now - next)
    }
    const offset = rowOffset(term)
    const start = colOf[match.start] ?? 0
    selectCells(term, { row: match.row + offset, col: start }, { row: match.row + offset, col: colOf[match.end - 1] ?? start })
  }

  // The next (1) or previous (-1) tab, round the ends.
  cycle(step: 1 | -1): void {
    if (this.tabs.length < 2 || !this.active) return
    this.select(this.tabs[(this.tabs.indexOf(this.active) + step + this.tabs.length) % this.tabs.length])
  }

  fit(): void {
    for (const pane of this.active?.panes ?? []) {
      const el = pane.term.element
      // Hidden (page left, or not laid out yet): nothing to measure.
      if (el?.isConnected && el.clientWidth) pane.fit.fit()
    }
  }

  // Clipboard: the selection out, text in (pasted as a whole, bracketed when the shell asks for it).
  async copy(tab = this.active): Promise<void> {
    if (!tab?.term.hasSelection()) return
    // Without the spaces that pad each line and the empty rows below the prompt (Tout sélectionner takes them).
    const text = tab.term.getSelection().replace(/[ \t]+$/gm, '').trimEnd()
    await navigator.clipboard.writeText(text)
    tab.term.clearSelection()
    tab.term.focus()
  }

  async paste(tab = this.active): Promise<void> {
    if (!tab) return
    const text = await navigator.clipboard.readText()
    if (text) tab.term.paste(text)
    tab.term.focus()
  }

  // Every line of the screen shown, its scrollback with it (ghostty-web's own selectAll misses them: ghostty.ts).
  selectAll(tab = this.active): void {
    const term = tab?.term
    const last = term ? term.buffer.active.length - 1 : -1
    if (!term || last < 0) return
    const offset = rowOffset(term)
    selectCells(term, { row: offset, col: 0 }, { row: offset + last, col: term.cols - 1 })
  }

  /**
   * Clears the scrollback and the screen but the cursor's line, which goes to the top, as xterm.js's clear() did:
   * the lines above it scrolled away (CSI S), the cursor taken up with them, then the scrollback erased (CSI 3 J).
   * ghostty-web's own clear() erases the screen, the prompt with it.
   */
  clear(tab = this.active): void {
    const term = tab?.term
    if (!term) return
    const { cursorX, cursorY } = term.buffer.active
    term.write(`${cursorY > 0 ? `\x1b[${cursorY}S` : ''}\x1b[1;${cursorX + 1}H\x1b[3J`)
    term.focus()
  }

  // The marks other extensions put on the tabs of a folder (Claude Code waiting for an answer there…).
  #marks = new Map<string, { state: TerminalMark; label: string | null }>()

  mark(folder: string, state: TerminalMark | null, label?: string): void {
    if (state) this.#marks.set(folder, { state, label: label ?? null })
    else this.#marks.delete(folder)
    this.#changed()
  }

  // A tab's mark: the one of the folder it works in (what an extension says, Claude Code waiting…), else a command
  // of its own that ended out of sight.
  markOf(tab: TerminalTab): { state: TerminalMark; label: string | null } | null {
    return (tab.folder ? this.#marks.get(tab.folder) : undefined) ?? tab.notice
  }

  // The folders of the tabs still running (the Claude page shows which task folders have one).
  folders(): Set<string> {
    return new Set(this.tabs.filter((t) => t.folder && t.panes[0]?.state !== 'exited').map((t) => t.folder!))
  }

  #makeTerm(ghostty: Ghostty): Terminal {
    // ghostty-web's scrollback (10 000 by default) is left as it is; its colours are the theme's of the moment.
    const term = new Terminal({
      ghostty,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: themeNow(),
    })
    term.attachCustomKeyEventHandler((e) => this.#shortcut(e, term))
    return term
  }

  /**
   * What a pane's shell says through its integration, read in its output before the terminal draws it (ghostty-web
   * has no hook for them): the marks around each command (OSC 133, 633;E) and its folder (OSC 7).
   */
  #read(pane: TerminalPane, data: string): void {
    for (const { code, data: body } of pane.osc.read(data)) {
      if (code === 133) {
        const done = pane.commands.mark(body, Date.now())
        if (done) this.#ended(pane, done)
      } else if (code === 633) {
        const line = commandLineOf(body)
        if (line !== null) pane.commands.line(line)
      } else if (code === 7) pane.cwd = folderOf(body) ?? pane.cwd
    }
  }

  /**
   * The links of a pane's lines, opened on a plain click: a web address, a task's reference (ID-123) the board knows, a
   * `file:line` (opened in the user's editor), a review of its repo (!45, #45: the repo of its folder, through the API).
   * ghostty-web counts lines from the oldest of the scrollback and columns from 0, the end of a range included.
   */
  #integrate(pane: TerminalPane): void {
    const term = pane.term
    term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = term.buffer.active.getLine(y)
        if (!line) return callback(undefined)
        const { text, colOf } = lineText(line, term.cols)
        const range = (m: { start: number; end: number }) => ({ start: { x: colOf[m.start], y }, end: { x: colOf[m.end - 1], y } })
        const links: ILink[] = findUrls(text).map((m) => ({
          range: range(m),
          text: m.text,
          activate: () => void window.open(m.text, '_blank'),
        }))
        for (const m of findFileLines(text)) {
          links.push({ range: range(m), text: m.text, activate: () => void this.#openFile(pane, m.path, m.line, m.column) })
        }
        const place = pane.place
        if (place) {
          for (const m of findReviews(text)) {
            links.push({ range: range(m), text: m.text, activate: () => void this.#openReview(place, m.kind, m.number) })
          }
        }
        void taskRefs().then(({ refs, urls }) => {
          for (const m of findTaskRefs(text, refs)) {
            links.push({
              range: range(m),
              text: m.text,
              activate: () => {
                const url = urls.get(m.ref)
                if (url) window.open(url, '_blank')
              },
            })
          }
          callback(links.length ? links : undefined)
        })
      },
    })
  }

  async #openFile(pane: TerminalPane, path: string, line: number, column: number | null): Promise<void> {
    const b = bridge()
    if (!b?.openFile) return
    const problem = await b.openFile({ path, line, column, cwd: pane.place, wsl: pane.wsl })
    if (problem) react('panic', problem, problem)
  }

  async #openReview(place: string, kind: 'mr' | 'pr', number: number): Promise<void> {
    const query = new URLSearchParams({ cwd: place, kind, number: String(number) })
    const res = await fetch(`/api/ext/lunar-industries-terminal/review?${query}`, { headers: { Accept: 'application/json' } }).catch(() => null)
    const url = res?.ok ? ((await res.json()) as { url: string | null }).url : null
    if (url) window.open(url, '_blank')
    else react('panic', 'Je ne trouve pas cette revue : le dépôt de cet onglet n’a pas de forge connue.', 'Revue introuvable')
  }

  // A command that ended: told when it took long and the user was elsewhere (another tab, page, or the window away).
  #ended(pane: TerminalPane, done: Finished): void {
    if (done.ms < LONG_COMMAND_MS) return
    const tab = pane.tab
    const seen = this.active === tab && tab.pane === pane && this.#host !== null && document.hasFocus() && !document.hidden
    if (seen) return
    const notice = noticeOf(done)
    tab.notice = { state: notice.ok ? 'done' : 'failed', label: notice.body }
    this.#changed()
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return
    const n = new Notification(notice.title, { body: notice.body, tag: `lterm-${tab.key}` })
    n.onclick = () => {
      window.focus()
      navigate(PAGE)
      if (!this.tabs.includes(tab)) return
      this.select(tab)
      this.focusPane(tab.panes.indexOf(pane), tab)
    }
  }

  /**
   * The app's keys, taken before the shell sees them (true: ghostty-web does not send it on; the reverse of xterm.js):
   * - Ctrl+Shift+C / Ctrl+Insert copy, and Ctrl+C too while text is selected (otherwise it stays the interrupt);
   * - Ctrl+Shift+V / Shift+Insert paste (⌘V on macOS too, bracketed when the shell asks for it);
   * - Ctrl+V stays the shell's (^V): ghostty-web would leave it to the browser, which pastes;
   * - Shift+Tab (the back tab), the other shifted keys and Alt with a character are sent as xterm sends them, which
   *   ghostty-web 0.4.0 does not (keys.ts); Shift+Page Up / Down scroll the scrollback;
   * - Ctrl+Shift+T opens a tab, Ctrl+Shift+W closes it, Ctrl+PageDown / PageUp go to the next / previous one;
   * - Ctrl+Shift+F searches the scrollback;
   * - Ctrl+Shift+E splits the tab side by side, Ctrl+Shift+O one above the other, Ctrl+Shift+an arrow goes to the
   *   other pane, and Ctrl+Shift+W closes the pane of a split tab;
   * - Ctrl+K (⌘K on macOS) goes to the command palette; on macOS, Ctrl+K stays the shell's.
   */
  #shortcut(e: KeyboardEvent, term: Terminal): boolean {
    const key = e.key.toLowerCase()
    const run = (action: () => unknown) => {
      if (e.type === 'keydown') {
        e.preventDefault()
        void action()
      }
      return true
    }
    if (e.metaKey && !e.ctrlKey && !e.altKey && key === 'v') return run(() => this.paste())
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && key === 'v') return run(() => term.input('\x16', true))
    const split = splitAction(e)
    if (split === 'split-row') return run(() => this.split('row'))
    if (split === 'split-column') return run(() => this.split('column'))
    if (split === 'other-pane') return run(() => this.active && this.focusPane(otherPane(this.active.focused, this.active.panes.length)))
    if (e.ctrlKey && e.shiftKey && !e.altKey) {
      if (key === 'c') return run(() => this.copy())
      if (key === 'v') return run(() => this.paste())
      if (key === 't') return run(() => this.add())
      if (key === 'w') return run(() => this.active && this.closePane(this.active))
      if (key === 'f') return run(() => this.openSearch())
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (key === 'c' && term.hasSelection()) return run(() => this.copy())
      if (key === 'insert') return run(() => this.copy())
      if (key === 'pagedown') return run(() => this.cycle(1))
      if (key === 'pageup') return run(() => this.cycle(-1))
    }
    if (e.shiftKey && !e.ctrlKey && key === 'insert') return run(() => this.paste())
    // What ghostty-web 0.4.0 sends wrong (keys.ts): Shift+Tab and the other shifted keys, Alt with a character; and
    // Shift+Page Up / Down scroll the scrollback, as in the official terminal.
    const scroll = pageScroll(e)
    if (scroll !== null) return run(() => term.scrollPages(scroll))
    const sequence = keySequence(e, platform() === 'darwin')
    if (sequence !== null) return run(() => term.input(sequence, true))
    // Ctrl+K (⌘K on macOS) is the palette's: kept from the shell, and left to go up to the window (ghostty-web stops
    // the keys it sends).
    if (isPaletteKey(e)) return true
    return false
  }

  // The shells' output and ends, each to its pane. An ended shell closes its pane in a split tab, else its tab, unless
  // it is the last one, which stays with its output and offers to start again.
  #listen(): void {
    const b = bridge()
    if (!b || this.#listening) return
    this.#listening = true
    const byPty = (id: number) => {
      for (const tab of this.tabs) for (const pane of tab.panes) if (pane.pty === id) return pane
      return undefined
    }
    b.onData((id, data) => {
      const pane = byPty(id)
      if (!pane) return
      this.#read(pane, data)
      pane.term.write(data)
    })
    b.onExit((id, code) => {
      const pane = byPty(id)
      if (!pane) return
      pane.pty = null
      const tab = pane.tab
      // In a split tab, the pane goes; the tab stays with the other one.
      if (tab.split) return this.closePane(tab, pane)
      if (this.tabs.length > 1 && !tab.keep) return this.close(tab)
      pane.exitCode = code
      pane.state = 'exited'
      this.#changed()
    })
  }
}

// One set of tabs for the whole app.
export const terminals = new TerminalTabs()
