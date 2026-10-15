import { relTime, statusColor, type Board, type Task, type TaskColumn, type TaskGroup } from '@bidule/sdk'
import type { KanbanBranch } from '../contract.ts'

// Taken from quack-board (Simon's kanban.ts and core/format.ts): what the board shows, without drawing it.

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral' | 'accent'

// The source's three groups: the name of a group of columns (read aloud, not shown) and the settings' legends.
export const GROUP_LABELS: Record<TaskGroup, string> = { todo: 'À faire', doing: 'En cours', done: 'Terminé' }
const GROUPS: TaskGroup[] = ['todo', 'doing', 'done']

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

// The hidden setting that keeps the columns' order (a JSON list of statuses' names), set in Réglages › Kanban.
export const ORDER = 'lunar-industries-kanban.order'

/**
 * The columns in the order the user chose (setting `lunar-industries-kanban.order`, the statuses' names), from the
 * source's order (`names`). A status the saved order does not have yet (a new one in the tool) comes right after the
 * one before it in the source's order, else first; a saved name the source no longer lists is left out.
 */
export function orderColumns(names: readonly string[], saved: readonly string[]): string[] {
  const known = new Set(names)
  const out = [...new Set(saved)].filter((name) => known.has(name))
  names.forEach((name, i) => {
    if (out.includes(name)) return
    const before = names.slice(0, i).findLast((other) => out.includes(other))
    out.splice(before === undefined ? 0 : out.indexOf(before) + 1, 0, name)
  })
  return out
}

// The list with `name` moved to `to` (a gap of the list as it is: 0 first, its length last).
export function moveName(names: readonly string[], name: string, to: number): string[] {
  const from = names.indexOf(name)
  if (from < 0) return [...names]
  const rest = names.filter((n) => n !== name)
  rest.splice(Math.max(0, Math.min(rest.length, from < to ? to - 1 : to)), 0, name)
  return rest
}

/**
 * What a status is on the board, as Réglages › Kanban sets it: a column of its own, no column (`hidden`, setting
 * `lunar-industries-kanban.hidden`), or its tasks in another column (`merged`, setting `statusMerge`). A status both
 * hidden and merged (an older setting) reads as hidden, as the board shows it.
 */
export type StatusChoice = { kind: 'shown' } | { kind: 'hidden' } | { kind: 'merged'; into: string }

export function choiceOf(name: string, hidden: readonly string[], merges: Merges): StatusChoice {
  if (hidden.includes(name)) return { kind: 'hidden' }
  const into = merges.get(name)
  return into ? { kind: 'merged', into } : { kind: 'shown' }
}

// Both settings once `name` has this choice: it is in at most one of them.
export function withChoice(
  name: string,
  choice: StatusChoice,
  hidden: readonly string[],
  merges: Merges,
): { hidden: string[]; merges: Map<string, string> } {
  const nextHidden = hidden.filter((h) => h !== name)
  const nextMerges = new Map(merges)
  nextMerges.delete(name)
  if (choice.kind === 'hidden') nextHidden.push(name)
  if (choice.kind === 'merged' && choice.into !== name) nextMerges.set(name, choice.into)
  return { hidden: nextHidden, merges: nextMerges }
}

/**
 * What a card's menu offers to open: one line per tool the task is in with an address there, for the active
 * providers only (`providers`, as the app names them), in the order the core gives them (the owner's first). The
 * core gives every source of a task (`sources`: a Notion task migrated into Plane is in both); an older one gives the
 * owner's alone (`provider`, `url`). Read without the SDK's type, which only the newer cores have.
 */
export type Opening = { provider: string; title: string; url: string }

export function openings(task: Pick<Task, 'provider' | 'url'>, providers: readonly { id: string; title: string }[]): Opening[] {
  const given: unknown = Reflect.get(task, 'sources')
  const sources = Array.isArray(given)
    ? given.flatMap((s: unknown) => {
        const provider: unknown = typeof s === 'object' && s !== null ? Reflect.get(s, 'provider') : null
        const url: unknown = typeof s === 'object' && s !== null ? Reflect.get(s, 'url') : null
        return typeof provider === 'string' && typeof url === 'string' && url ? [{ provider, url }] : []
      })
    : task.url
      ? [{ provider: task.provider, url: task.url }]
      : []
  const titles = new Map(providers.map((p) => [p.id, p.title]))
  const seen = new Set<string>()
  return sources.flatMap(({ provider, url }) => {
    const title = titles.get(provider)
    if (!title || seen.has(provider)) return []
    seen.add(provider)
    return [{ provider, title, url }]
  })
}

export interface Column extends TaskColumn {
  // A status the tasks have but the source no longer lists.
  unknown: boolean
  // The other statuses it shows (merged into it).
  merged: string[]
  // Folded: the finished columns start so; a column the user folded or unfolded against that keeps their choice.
  folded: boolean
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
 * The source's statuses in the board's order: the one the user chose (`order`, see `orderColumns`), else by stage. The
 * core lists each tool's statuses after the previous tool's (by id): with two, a status only the second has would come
 * after the first's finished ones. By stage, then, in the order they come otherwise.
 */
export function boardColumns(columns: readonly TaskColumn[], order: readonly string[] = []): TaskColumn[] {
  const byStage = GROUPS.flatMap((group) => columns.filter((c) => c.group === group))
  const byName = new Map(byStage.map((c) => [c.name, c]))
  return orderColumns(
    byStage.map((c) => c.name),
    order,
  ).map((name) => byName.get(name)!)
}

/**
 * The columns shown (the source's, less those merged into another, then the statuses it no longer has), grouped: the
 * neighbouring columns of a stage make one group. `merges`: those that apply (`applicableMerges`); `order`: the user's.
 */
export function groupsOf(
  board: Board,
  hidden: string[],
  toggled: ReadonlySet<string>,
  merges: Merges = new Map(),
  order: readonly string[] = [],
): Group[] {
  const listed = new Set(board.columns.map((c) => c.name))
  const strays = [...new Set(board.tasks.map((t) => columnOf(t, merges)).filter((s) => !listed.has(s)))]
  const stray = (name: string): TaskColumn & { unknown: boolean } => ({ name, color: 'neutral', group: 'todo', unknown: true })
  const columns: Column[] = [
    ...boardColumns(board.columns, order)
      .filter((c) => !merges.has(c.name))
      .map((c) => ({ ...c, unknown: false })),
    ...strays.map(stray),
  ]
    .filter((c) => !hidden.includes(c.name))
    .map((c) => {
      // Every column folds; the finished ones start folded, until the user unfolds them.
      const byDefault = c.group === 'done'
      return {
        ...c,
        merged: mergedInto(c.name, merges),
        folded: byDefault !== toggled.has(c.name),
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

// Days from `today` to the task's due date (negative: late); null without one.
export function daysLeft(task: Pick<Task, 'due'>, today: string): number | null {
  if (!task.due) return null
  return Math.round((Date.parse(`${task.due.slice(0, 10)}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 864e5)
}

// A card's badge: late (the one card that stands out: `accent`), due today, or its due date; none once done.
export function badgeOf(task: Task, done: boolean, today: string): Badge | null {
  const days = done ? null : daysLeft(task, today)
  if (days === null || !task.due) return null
  if (days < 0) return { text: `en retard · ${-days} j`, tone: 'accent' }
  if (days === 0) return { text: "aujourd'hui", tone: 'warn' }
  return { text: DATE.format(new Date(`${task.due.slice(0, 10)}T12:00:00`)), tone: 'neutral' }
}

// What the card says under its marks when it says something: the user only takes part, or the task has not changed
// for two weeks (it may be stuck). Nothing for a finished one.
export const STALE_DAYS = 14
export function noteOf(task: Pick<Task, 'role' | 'lastEdited'>, done: boolean, now = Date.now()): string | null {
  const parts: string[] = []
  if (task.role === 'participant') parts.push('participant')
  if (!done && task.lastEdited) {
    const days = Math.floor((now - Date.parse(task.lastEdited)) / 864e5)
    if (days >= STALE_DAYS) parts.push(`inchangée depuis ${days} j`)
  }
  return parts.length ? parts.join(' · ') : null
}

// The card's branch: the first one's full name, « +N » for the others; empty without one (the card says nothing).
export function branchLabel(branches: KanbanBranch[]): string {
  const [first] = branches
  if (!first) return ''
  return first.name + (branches.length > 1 ? ` +${branches.length - 1}` : '')
}

const CI_MARK: Partial<Record<string, { text: string; tone: Tone }>> = {
  ok: { text: 'CI verte', tone: 'ok' },
  fail: { text: 'CI rouge', tone: 'bad' },
  pending: { text: 'CI en cours', tone: 'info' },
}

export type Mark = { key: string; repo: string; name: string; url: string | null; text: string; tone: Tone; tip: string }

// A branch's marks: its review (« !12 », « !12 fusionnée »), then its CI while it matters (verte, rouge, en cours); a
// click opens it on the forge (`url`, the review's, else the pipeline's).
export function marksOf(branches: KanbanBranch[]): Mark[] {
  return branches.flatMap((b) => {
    const marks: Mark[] = []
    // A provider may give the review's number without its reference (« !12 »).
    const ref = b.reviewRef || (b.reviewNumber !== null ? `#${b.reviewNumber}` : '')
    const merged = b.reviewState === 'merged' || b.ci === 'merged'
    const base = { repo: b.repo, name: b.name, url: b.url }
    if (ref) {
      const short = ref.replace(/^[A-Z]+\s*/, '')
      marks.push({
        ...base,
        key: `${branchKey(b)}\u0000review`,
        text: merged ? `${short} fusionnée` : b.reviewState === 'closed' ? `${short} fermée` : short,
        tone: 'neutral',
        tip: `${b.repoLabel} · ${ref}`,
      })
    }
    const ci = !merged && b.ci ? CI_MARK[b.ci] : undefined
    if (ci) marks.push({ ...base, key: `${branchKey(b)}\u0000ci`, ...ci, tip: `${b.repoLabel} · ${b.name} · ${ci.text}` })
    return marks
  })
}

// ---------- finding a task: the search, the filter, and what needs attention

export type TaskFilter = 'all' | 'owner' | 'participant' | 'late' | 'today' | 'ci'

export const FILTER_LABELS: Record<TaskFilter, string> = {
  all: 'Toutes',
  owner: 'Responsable',
  participant: 'Participant',
  late: 'En retard',
  today: "Pour aujourd'hui",
  ci: 'CI rouge',
}

// What the board needs to tell each task apart: its stage (done or not) and its branches.
export type TaskContext = { done: (task: Task) => boolean; branches: (task: Task) => KanbanBranch[]; today: string }

const failing = (branches: KanbanBranch[]) => branches.some((b) => b.ci === 'fail')

export function matchesFilter(task: Task, filter: TaskFilter, ctx: TaskContext): boolean {
  if (filter === 'all') return true
  if (filter === 'owner' || filter === 'participant') return task.role === filter
  if (ctx.done(task)) return false
  const days = daysLeft(task, ctx.today)
  if (filter === 'late') return days !== null && days < 0
  if (filter === 'today') return days === 0
  return failing(ctx.branches(task))
}

// Every word of the search in the task's title, its reference or one of its branches' names, accents and case aside.
export function matchesQuery(task: Task, query: string, branches: KanbanBranch[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = fold([task.title, task.ref ?? '', ...branches.map((b) => b.name)].join(' '))
  return words.every((w) => text.includes(w))
}

// How many tasks need attention, the finished ones aside: late, due today, with a failing CI.
export function attentionOf(tasks: readonly Task[], ctx: TaskContext): { late: number; today: number; ci: number } {
  const open = tasks.filter((t) => !ctx.done(t))
  return {
    late: open.filter((t) => matchesFilter(t, 'late', ctx)).length,
    today: open.filter((t) => matchesFilter(t, 'today', ctx)).length,
    ci: open.filter((t) => matchesFilter(t, 'ci', ctx)).length,
  }
}

// The words a branch's name brings to find its task: its parts (`feat/TSK-142-export-csv` → tsk, 142, export, csv),
// without its kind (feat, fix…) and the words too short to mean anything.
const KINDS = new Set(['feat', 'feature', 'fix', 'hotfix', 'chore', 'docs', 'doc', 'refactor', 'test', 'tests', 'ci', 'build', 'perf', 'style'])
export function branchWords(name: string): string[] {
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !KINDS.has(w))
}

/**
 * The tasks to offer for a branch, best first: those whose title or reference has the most of the branch's words, the
 * unfinished ones before the others; only those matching every word typed (`query`), eight at most.
 */
export function tasksForBranch(tasks: readonly Task[], branch: string, query: string, done: (task: Task) => boolean): Task[] {
  const words = branchWords(branch)
  const typed = fold(query).split(/\s+/).filter(Boolean)
  const text = (t: Task) => fold(`${t.ref ?? ''} ${t.title}`)
  return tasks
    .filter((t) => typed.every((w) => text(t).includes(w)))
    .map((task, i) => ({ task, i, score: words.filter((w) => text(task).includes(w)).length, done: done(task) }))
    .sort((a, b) => b.score - a.score || Number(a.done) - Number(b.done) || a.i - b.i)
    .slice(0, 8)
    .map(({ task }) => task)
}

// A column's cards: the late ones first (the longest overdue first), then by due date, then those without one, each
// keeping the order the core gave otherwise.
export function sortTasks(tasks: readonly Task[], today: string): Task[] {
  const rank = (t: Task) => daysLeft(t, today) ?? Number.POSITIVE_INFINITY
  return tasks
    .map((task, i) => ({ task, i }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.i - b.i)
    .map(({ task }) => task)
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

export function parseList(value: unknown): string[] {
  try {
    const list = JSON.parse(String(value ?? '[]'))
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}
