import type { StoredType } from '@bidule/sdk/objects'
import type { LogEntry, LogLine, TaskGroup, TimeLog } from '@bidule/sdk/tasks'
import { Days, type DayLog, type Work, type WorkBranch } from '../server/days.ts'
import type { WorkEvent } from '../server/engine.ts'
import { DEFAULT_SETTINGS, type TempsSettings } from '../server/settings.ts'
import type { DraftRow, LogRow, NewDraftRow, TempsStore } from '../server/store.ts'
import type { Props } from '../contract.ts'

// A piece of git's activity, on a branch of a repo.
type GitEvent = WorkEvent & { kind: 'checkout' | 'commit' | 'branch' | 'edit'; repo: string; branch: string }

// The module's tables, in memory.
export class MemoryStore implements TempsStore {
  draftRows: DraftRow[] = []
  editedSet = new Set<string>()
  log: (LogRow & { deleted: boolean })[] = []
  #id = 1

  remembered = new Map<string, { repo: string; branch: string; taskId: string }>()
  async rememberBranches(live: { repo: string; branch: string; taskId: string | null }[]) {
    for (const { repo, branch, taskId } of live) {
      const key = `${repo}\u0000${branch}`
      if (taskId === null) this.remembered.delete(key)
      else this.remembered.set(key, { repo, branch, taskId })
    }
  }
  async rememberedBranches() {
    return [...this.remembered.values()]
  }
  async drafts(day: string) {
    return this.draftRows.filter((r) => r.day === day).sort((a, b) => b.share - a.share || a.id - b.id)
  }
  async daysWithDraft(days: string[]) {
    return new Set(this.draftRows.filter((r) => days.includes(r.day)).map((r) => r.day))
  }
  async writeDraft(day: string, rows: NewDraftRow[], edited?: boolean) {
    this.draftRows = this.draftRows.filter((r) => r.day !== day)
    for (const r of rows) {
      this.draftRows.push({
        id: this.#id++,
        day,
        taskId: r.taskId,
        label: r.label,
        repo: r.repo ?? null,
        branch: r.branch ?? null,
        share: r.share,
        tiny: Boolean(r.tiny),
        confirmed: Boolean(r.confirmed),
        reason: r.reason ?? '',
        props: r.props ?? {},
      })
    }
    if (edited !== undefined) await this.setEdited(day, edited)
  }
  async edited(day: string) {
    return this.editedSet.has(day)
  }
  async editedDays(days: string[]) {
    return new Set(days.filter((d) => this.editedSet.has(d)))
  }
  async setEdited(day: string, edited: boolean) {
    if (edited) this.editedSet.add(day)
    else this.editedSet.delete(day)
  }
  async logged(days: string[]) {
    return this.log.filter((r) => !r.deleted && days.includes(r.day)).sort((a, b) => b.share - a.share)
  }
  async lastLogged() {
    const out = new Map<string, { label: string; props: Props }>()
    for (const r of [...this.log].filter((r) => !r.deleted && r.taskId).sort((a, b) => b.day.localeCompare(a.day))) {
      if (r.taskId && !out.has(r.taskId)) out.set(r.taskId, { label: r.label, props: r.props })
    }
    return out
  }
  async usedLabels() {
    return [...new Set(this.log.filter((r) => !r.deleted).map((r) => r.label))].filter(Boolean)
  }
  async recordLog(entries: LogRow[], from: string, to: string) {
    for (const e of entries) {
      this.log = this.log.filter((r) => r.id !== e.id)
      this.log.push({ ...e, deleted: false })
    }
    const ids = new Set(entries.map((e) => e.id))
    for (const r of this.log) if (r.day >= from && r.day <= to && !ids.has(r.id)) r.deleted = true
  }
  async followMerge(type: StoredType, from: string, into: string) {
    if (type === 'task') {
      for (const r of this.draftRows) if (r.taskId === from) r.taskId = into
      for (const r of this.remembered.values()) if (r.taskId === from) r.taskId = into
      for (const r of this.log) if (r.taskId === from) r.taskId = into
    } else if (type === 'timeEntry') {
      if (this.log.some((r) => r.id === into)) this.log = this.log.filter((r) => r.id !== from)
      else for (const r of this.log) if (r.id === from) r.id = into
    }
  }
  // A line of a draft, as the tests write them.
  draft(day: string, lines: Partial<NewDraftRow>[]) {
    return this.writeDraft(
      day,
      lines.map((l) => ({ taskId: null, label: 'Développement', share: 0, confirmed: false, ...l }))
    )
  }
}

// The user's repos: branches (with their task, whether they are the default, whether the user unlinked them by hand),
// events, links.
export class FakeGit {
  branchRows: WorkBranch[] = []
  eventRows: GitEvent[] = []
  links: [string, string, string | null][] = []

  branch(repo: string, name: string, o: { taskId?: string | null; isDefault?: boolean; noTask?: boolean } = {}) {
    this.branchRows.push({ repo, name, taskId: o.taskId ?? null, isDefault: o.isDefault ?? false, noTask: o.noTask ?? false })
  }
  event(at: string, kind: GitEvent['kind'], repo: string, branch: string, detail = '') {
    const taskId = this.branchRows.find((b) => b.repo === repo && b.name === branch)?.taskId ?? null
    this.eventRows.push({ at, kind, repo, branch, detail, taskId })
  }
}

// The tasks: their titles, the user's edits and changes of status.
export class FakeTasks {
  edits: { at: string; taskId: string }[] = []
  changes: { at: string; taskId: string; to: string; toGroup: TaskGroup | null }[] = []
  list: { id: string; title: string; ref?: string | null; url?: string | null }[] = []
}

// The user's work as the core would give it: git's activity and the tasks', the branches, their links.
export function fakeWork(git: FakeGit, tasks: FakeTasks): Work {
  const within = (since: string, until: string) => (e: { at: string }) => e.at >= since && e.at < until
  return {
    repos: async () => [...new Set(git.branchRows.map((b) => b.repo))].map((path) => ({ path, label: path })),
    branches: async () => git.branchRows,
    events: async (since, until) => [
      ...git.eventRows.filter(within(since, until)),
      ...tasks.edits
        .filter(within(since, until))
        .map((e): WorkEvent => ({ at: e.at, kind: 'task', repo: null, branch: null, detail: 'Tâche modifiée', taskId: e.taskId })),
      ...tasks.changes.filter(within(since, until)).map(
        (c): WorkEvent => ({ at: c.at, kind: 'status', repo: null, branch: null, detail: `→ ${c.to}`, taskId: c.taskId, toGroup: c.toGroup })
      ),
    ],
    link: async (repo, name, taskId) => {
      git.links.push([repo, name, taskId])
      const b = git.branchRows.find((x) => x.repo === repo && x.name === name)
      if (b) b.taskId = taskId
    },
    tasks: async () => new Map(tasks.list.map((t) => [t.id, { title: t.title, ref: t.ref ?? null, url: t.url ?? null }])),
  }
}

// A Time Log that reads and writes whole days, as Notion's does: one entry per (task, label) and day.
export class FakeTimeLog implements TimeLog {
  readonly name = 'Fake'
  entries: (LogEntry & { archived: boolean })[] = []
  calls: string[] = []
  #id = 1
  constructor(protected rich = true) {}
  async configured() {
    return true
  }
  async write(): Promise<string> {
    throw new Error('not used')
  }
  async remove(id: string) {
    this.calls.push(`remove ${id}`)
    const e = this.entries.find((x) => x.id === id)
    if (e) e.archived = true
  }
  async fields() {
    return { labels: ['Développement', 'Réunion', 'Absent', 'Déploiement'], extras: [] }
  }
  async read(from: string, to: string): Promise<LogEntry[]> {
    return this.entries
      .filter((e) => !e.archived && e.day >= from && e.day <= to)
      .map((e) => ({ id: e.id, day: e.day, taskId: e.taskId, label: e.label, share: e.share, url: e.url, props: e.props, lastEdited: e.lastEdited }))
  }
  // The lines of the last day sent, as the Time Log received them.
  lines: LogLine[] = []
  async sendDay(day: string, lines: LogLine[]): Promise<LogEntry[]> {
    this.calls.push(`send ${day}`)
    this.lines = lines
    const pair = (taskId: string | null, label: string | null) => `${taskId ?? ''}|${label ?? ''}`
    const unused = new Map(this.entries.filter((e) => !e.archived && e.day === day).map((e) => [pair(e.taskId, e.label), e]))
    const written: LogEntry[] = []
    for (const line of lines) {
      const key = pair(line.task?.id ?? null, line.label)
      let entry = unused.get(key)
      unused.delete(key)
      if (!entry) {
        entry = { id: `p${this.#id++}`, day, taskId: line.task?.id ?? null, label: line.label, share: 0, url: null, props: {}, lastEdited: '', archived: false }
        this.entries.push(entry)
      }
      Object.assign(entry, { share: line.share, props: line.props ?? {}, lastEdited: new Date().toISOString() })
      written.push({ ...entry })
    }
    for (const e of unused.values()) e.archived = true
    return written
  }
}

// A Time Log with a task and a share only (no labels, no reading back).
export class PlainTimeLog implements TimeLog {
  readonly name = 'Plain'
  async configured() {
    return true
  }
  async write() {
    return 'x'
  }
  async remove() {}
}

// A Time Log as the core gives it today (Notion's `timeEntry.read`): the user's entries are read, a whole day is not
// written.
export class ReadingTimeLog {
  readonly name = 'Lu'
  constructor(protected log: FakeTimeLog) {}
  async configured() {
    return true
  }
  read(from: string, to: string) {
    return this.log.read(from, to)
  }
}

// The settings of the tests: the module's defaults, and integration branches as one team names them.
export const SETTINGS: TempsSettings = {
  ...DEFAULT_SETTINGS,
  integrationBranches: ['main', 'master', 'develop', 'launchpad', 'factory', 'orbit'],
}

export function setup(o: { now: Date; settings?: Partial<TempsSettings>; log?: DayLog | null }) {
  const store = new MemoryStore()
  const git = new FakeGit()
  const tasks = new FakeTasks()
  const log = o.log === undefined ? new FakeTimeLog() : o.log
  let changes = 0
  const days = new Days({
    store,
    settings: async () => ({ ...SETTINGS, ...o.settings }),
    work: fakeWork(git, tasks),
    timeLog: async () => log,
    changed: () => (changes += 1),
    now: () => o.now,
  })
  return { store, git, tasks, log, days, changes: () => changes }
}
