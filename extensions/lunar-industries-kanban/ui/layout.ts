import { statusColor, type Board, type Task, type TaskColumn, type TaskGroup } from '@bidule/sdk'
import type { KanbanBranch } from '../contract.ts'

// Taken from quack-board (Simon's kanban.ts and core/format.ts): what the board shows, without drawing it.

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral' | 'accent'

// The source's three groups: the name of a group of columns (read aloud, not shown) and the settings' legends.
export const GROUP_LABELS: Record<TaskGroup, string> = { todo: 'À faire', doing: 'En cours', done: 'Terminé' }

// A branch shown with a few marks less: its type (`feat/`) and its task's ID (`TSK-42-`), which the card already says.
export const shortBranch = (name: string) => name.replace(/^[\w.-]+\//, '').replace(/^[a-z]+-\d+-/i, '')

export const branchKey = (b: { repo: string; name: string }) => `${b.repo}\u0000${b.name}`

// A branch is recent for 14 days after its last commit.
export const RECENT_DAYS = 14
export const isRecent = (at: string | null, now = Date.now()) =>
  at !== null && now - new Date(at).getTime() < RECENT_DAYS * 864e5

// Recent branches without a task, not merged: to drop on a card. A branch linked to a task the board does not show (done
// and hidden, someone else's) has no card either: it counts as without a task, so that it can be found and moved.
export const orphansOf = (branches: KanbanBranch[], now = Date.now(), onBoard?: ReadonlySet<string>) =>
  branches.filter(
    (b) =>
      (!b.taskId || (onBoard !== undefined && !onBoard.has(b.taskId))) &&
      isRecent(b.lastCommitAt, now) &&
      b.reviewState !== 'merged' &&
      b.ci !== 'merged'
  )

// The colours of the statuses of these names (the theme's `--col-*`), this board's own choice as the official one's.
const NAMED: [RegExp, string][] = [
  [/^(à|a) faire|^todo|^to do|backlog/i, 'var(--col-todo)'],
  [/^en cours|in progress|doing/i, 'var(--col-doing)'],
  [/bloqu|block/i, 'var(--col-blocked)'],
  [/staging|test|recette|review/i, 'var(--col-staging)'],
  [/prod/i, 'var(--col-prod)'],
  [/^fini|^termin|^done|complete/i, 'var(--col-done)'],
]

// A column's dot: the colour of a status of these names, its provider's otherwise.
export function columnColor(column: TaskColumn): string {
  return NAMED.find(([name]) => name.test(column.name))?.[1] ?? statusColor(column)
}

/**
 * Statuses shown in another column (setting `lunar-industries-kanban.statusMerge`, a JSON object `{ from: into }`):
 * two tools naming the same stage differently (« En cours/dev » and « En cours »), or states a team treats as one.
 * The status `from` has no column of its own; its tasks sit in `into` and keep their status in their tool.
 */
export type Merges = ReadonlyMap<string, string>

export function parseMerges(value: unknown): Map<string, string> {
  try {
    const raw: unknown = JSON.parse(String(value ?? '{}'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map()
    return new Map(
      Object.entries(raw).flatMap(([from, into]) => (typeof into === 'string' && into && into !== from ? [[from, into]] : [])),
    )
  } catch {
    return new Map()
  }
}

/**
 * The merges that apply to these columns: both statuses must be listed (a renamed status does not hide its tasks), and
 * what is merged into a status itself merged goes to the end of the chain. A chain that comes back on itself would hide
 * every column of the loop and their tasks with them: none of its merges applies.
 */
export function applicableMerges(merges: Merges, columns: readonly string[]): Map<string, string> {
  const known = new Set(columns)
  const into = new Map([...merges].filter(([from, to]) => known.has(from) && known.has(to)))
  const end = (name: string): string | null => {
    const seen = new Set([name])
    let at = name
    for (let next = into.get(at); next !== undefined; next = into.get(at)) {
      if (seen.has(next)) return null
      seen.add(next)
      at = next
    }
    return at
  }
  return new Map(
    [...into.keys()].flatMap((from) => {
      const target = end(from)
      return target === null ? [] : [[from, target]]
    }),
  )
}

// The column a task sits in: compare this, never its status, with a column's name.
export const columnOf = (task: Pick<Task, 'status'>, merges: Merges) => merges.get(task.status) ?? task.status

// The statuses a column shows besides its own.
export const mergedInto = (column: string, merges: Merges) =>
  [...merges].filter(([, into]) => into === column).map(([from]) => from)

/**
 * The statuses to try, in order, when a task is dropped in a column: the board does not say which tool lists which
 * status, so those the task's tool already uses on the board come first, then the column's own, then the others merged
 * into it. A tool refusing one (Notion: « n'existe pas ») gets the next.
 */
export function moveCandidates(task: Pick<Task, 'provider'>, column: string, merges: Merges, tasks: readonly Task[]): string[] {
  const all = [column, ...mergedInto(column, merges)]
  const used = new Set(tasks.filter((t) => t.provider === task.provider).map((t) => t.status))
  return [...all.filter((s) => used.has(s)), ...all.filter((s) => !used.has(s))]
}

export interface Column extends TaskColumn {
  // A status the tasks have but the source no longer lists.
  unknown: boolean
  // The other statuses it shows (merged into it).
  merged: string[]
  // Finished columns start folded; a column the user folded or unfolded against that keeps their choice.
  folded: boolean
  foldable: boolean
  tasks: Task[]
}

export interface Group {
  key: string
  label: string
  columns: Column[]
  // Spare width goes to the groups in proportion to their open columns.
  grow: number
}

/**
 * The columns shown (the source's, less those merged into another, then the statuses it no longer has), grouped, in
 * the source's order. `merges`: those that apply (`applicableMerges`).
 */
export function groupsOf(board: Board, hidden: string[], toggled: ReadonlySet<string>, merges: Merges = new Map()): Group[] {
  const listed = new Set(board.columns.map((c) => c.name))
  const strays = [...new Set(board.tasks.map((t) => columnOf(t, merges)).filter((s) => !listed.has(s)))]
  const stray = (name: string): TaskColumn & { unknown: boolean } => ({ name, color: 'neutral', group: 'todo', unknown: true })
  const columns: Column[] = [
    ...board.columns.filter((c) => !merges.has(c.name)).map((c) => ({ ...c, unknown: false })),
    ...strays.map(stray),
  ]
    .filter((c) => !hidden.includes(c.name))
    .map((c) => {
      const foldable = c.group === 'done'
      return {
        ...c,
        merged: mergedInto(c.name, merges),
        foldable,
        folded: foldable !== toggled.has(c.name),
        tasks: board.tasks.filter((t) => columnOf(t, merges) === c.name),
      }
    })
  const out: Group[] = []
  for (const col of columns) {
    const last = out.at(-1)
    // A status the source dropped stands alone.
    const key = col.unknown ? `col:${col.name}` : col.group
    if (last && last.key === key) last.columns.push(col)
    else out.push({ key, label: col.unknown ? '' : GROUP_LABELS[col.group], columns: [col], grow: 0 })
  }
  for (const g of out) g.grow = g.columns.filter((c) => !c.folded).length
  return out
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const DATE = new Intl.DateTimeFormat('fr', { weekday: 'short', day: 'numeric' })

export type Badge = { text: string; tone: Tone }

// A card's badge: due today (the one urgent one), late, or its due date (warm within three days); none once done.
export function badgeOf(task: Task, done: boolean, today: string): Badge | null {
  if (done || !task.due) return null
  const due = task.due.slice(0, 10)
  if (due === today) return { text: "Aujourd'hui", tone: 'accent' }
  const days = Math.round((Date.parse(`${due}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 864e5)
  if (days < 0) return { text: 'En retard', tone: 'bad' }
  return { text: DATE.format(new Date(`${due}T12:00:00`)), tone: days <= 3 ? 'warn' : 'neutral' }
}

// The first branch's short name, « +N » for the others.
export function branchLabel(branches: KanbanBranch[]): string {
  const [first] = branches
  if (!first) return 'sans branche'
  return shortBranch(first.name) + (branches.length > 1 ? ` +${branches.length - 1}` : '')
}

const CI_TONE: Record<string, Tone> = { ok: 'ok', fail: 'bad', pending: 'warn', none: 'neutral', merged: 'info' }
const CI_TEXT: Record<string, string> = {
  ok: 'CI OK',
  fail: 'CI en échec',
  pending: 'CI en cours',
  none: 'sans CI',
  merged: 'mergée',
}

export type Mark = { key: string; repo: string; name: string; text: string; tone: Tone; tip: string }

// One mark per branch with a review or a pipeline: « !12 », « #4 », or « CI »; a click opens it on the forge.
export function marksOf(branches: KanbanBranch[]): Mark[] {
  return branches
    .filter((b) => b.reviewRef || b.reviewNumber !== null || (b.ci && b.ci !== 'none'))
    .map((b) => {
      const ci = b.ci ?? 'none'
      // A provider may give the review's number without its reference (« !12 »).
      const ref = b.reviewRef || (b.reviewNumber !== null ? `#${b.reviewNumber}` : '')
      return {
        key: branchKey(b),
        repo: b.repo,
        name: b.name,
        text: ref ? ref.replace(/^[A-Z]+\s*/, '') : 'CI',
        tone: CI_TONE[ci],
        tip: [b.repoLabel, ref, ref && ci === 'merged' ? '' : CI_TEXT[ci]].filter(Boolean).join(' · '),
      }
    })
}

export type LinkRow = { key: string; name: string; repo: string; note: string; checked: boolean }

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * The « Lier des branches… » dialog's rows, grouped by repo in the order they first come: the task's branches, then
 * those without a task, then the others' (« liée à … »), merged ones last; the most recent first.
 */
export function linkRows(
  branches: KanbanBranch[],
  taskId: string,
  query: string,
  titleOf: (taskId: string) => string,
  checked: ReadonlySet<string>,
): LinkRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const rank = (b: KanbanBranch) =>
    b.taskId === taskId ? 0 : b.reviewState === 'merged' || b.ci === 'merged' ? 3 : b.taskId ? 2 : 1
  const shown = branches
    .filter((b) => words.every((w) => fold(`${b.name} ${b.repoLabel}`).includes(w)))
    .sort((a, b) => rank(a) - rank(b) || (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''))
  const order = [...new Set(shown.map((b) => b.repo))]
  return shown
    .sort((a, b) => order.indexOf(a.repo) - order.indexOf(b.repo))
    .map((b) => ({
      key: branchKey(b),
      name: b.name,
      repo: b.repoLabel,
      note: b.taskId && b.taskId !== taskId ? `liée à ${titleOf(b.taskId)}` : relTime(b.lastCommitAt),
      checked: checked.has(branchKey(b)),
    }))
}

const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
// « il y a 3 jours », « hier ».
export function relTime(at: string | null, now = Date.now()): string {
  if (!at) return ''
  const minutes = (new Date(at).getTime() - now) / 60_000
  if (Math.abs(minutes) < 60) return RELATIVE.format(Math.round(minutes), 'minute')
  if (Math.abs(minutes) < 60 * 24) return RELATIVE.format(Math.round(minutes / 60), 'hour')
  return RELATIVE.format(Math.round(minutes / 60 / 24), 'day')
}

export function parseList(value: unknown): string[] {
  try {
    const list = JSON.parse(String(value ?? '[]'))
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

// The branch tray (setting `lunar-industries-kanban.trayOpen`): open unless the user closed it (« false »).
export const trayIsOpen = (value: unknown) => value !== 'false'
