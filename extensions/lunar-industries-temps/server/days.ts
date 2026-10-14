import type { LogEntry, LogFields, LogLine, TimeLog } from '@bidule/sdk/tasks'
import type { DayLine, DayState, DaySummary, DayView, LineInput, Summary } from '../contract.ts'
import {
  addDays,
  branchKey,
  DAY_SHARES,
  dayKey,
  dayStart,
  DEPLOY_KEY,
  integrationOf,
  lineOf,
  localDay,
  minuteOf,
  placeKey,
  proposeShares,
  reconstruct,
  taskKey,
  type BranchInfo,
  type DayInput,
  type WorkEvent,
} from './engine.ts'
import { fillTaskText, type TempsSettings } from './settings.ts'
import type { DraftRow, LogRow, NewDraftRow, TempsStore } from './store.ts'

/**
 * Taken from quack-board (domain/day.ts and domain/time_log.ts, Simon's): the user's days. Each day's draft follows
 * the signals until the user changes it; a day the Time Log has is shown as it is there, and « Modifier » makes it a
 * draft again. Sending writes the whole day to the Time Log (its sendDay), which then holds it.
 */

// Refused edits; the message is shown to the user.
export class DraftError extends Error {}

// The Time Log is mirrored as far back as git is read (35 days), and some weeks ahead (planned absences).
export const LOG_WINDOW_DAYS = 35
const LOG_AHEAD_DAYS = 60
// A period read from the Time Log is read again after this long.
const FRESH_MS = 10 * 60_000

// A branch of the user's repos, with the task it is linked to; `noTask`: the user unlinked it by hand (the core's mark).
export type WorkBranch = { repo: string; name: string; taskId: string | null; isDefault: boolean; noTask: boolean }

/** The user's work as the core has it (server/work.ts reads it from the core's objects). */
export interface Work {
  repos(): Promise<{ path: string; label: string }[]>
  // The branches the repos have now.
  branches(): Promise<WorkBranch[]>
  // The user's signals between two instants: git's activity (with the task of its branch, kept once the branch is
  // deleted) and the tasks' (an edit, a change of status).
  events(since: string, until: string): Promise<WorkEvent[]>
  // Links a branch to a task by hand.
  link(repo: string, branch: string, taskId: string): Promise<void>
  // The tasks, by id: their title, and their reference and address in the tool that owns them.
  tasks(): Promise<Map<string, WorkTask>>
}

export type WorkTask = { title: string; ref: string | null; url: string | null }

// The Time Log as the days use it: the user's entries of a period and, when its provider offers them, its fields and
// a whole day written at once.
export type DayLog = Pick<TimeLog, 'name' | 'configured' | 'read' | 'fields' | 'sendDay'>
type ReadingLog = DayLog & Required<Pick<DayLog, 'read'>>
const reads = (log: DayLog | null): log is ReadingLog => typeof log?.read === 'function'
type SendingLog = DayLog & Required<Pick<DayLog, 'sendDay'>>
const sends = (log: DayLog): log is SendingLog => typeof log.sendDay === 'function'

export interface DaysDeps {
  store: TempsStore
  settings: () => Promise<TempsSettings>
  work: Work
  // Null without a provider of time entries.
  timeLog: () => Promise<DayLog | null>
  // A day changed: whoever shows the days reloads.
  changed: () => void
  now?: () => Date
}

export const NO_LOG = 'Aucun Time Log branché : aucune extension ne fournit les entrées de temps'
export const noWholeDay = (name: string) =>
  `Le Time Log de ${name} ne reçoit pas de journée entière (étiquettes, absences, autres propriétés) : la journée se prépare ici, mais ne s'envoie pas`

// 1 = Monday … 7 = Sunday, on the local date.
const isoWeekday = (day: string) => dayStart(day).getDay() || 7

const lineKeyOf = (l: { taskId: string | null; repo: string | null; branch: string | null; label: string }) =>
  l.taskId ? taskKey(l.taskId) : l.repo && l.branch ? branchKey(l.repo, l.branch) : `none:${l.label}`

// Two entries of the Time Log cannot share a task and a label; lines without a task are told apart by the branch
// they come from (they merge when sent).
const identity = (l: LineInput) => `${l.taskId ?? `${l.repo ?? ''}\u0000${l.branch ?? ''}`}\u0000${l.label}`

const toTwentieths = (share: number) => Math.round(share * DAY_SHARES)
const logRowOf = (e: LogEntry): LogRow => ({
  id: e.id,
  day: e.day,
  taskId: e.taskId,
  label: e.label ?? '',
  share: toTwentieths(e.share),
  url: e.url,
  props: e.props,
  lastEdited: e.lastEdited,
})

export class Days {
  // When each period was last read from the Time Log (`from|to`).
  #readAt = new Map<string, number>()
  #reading = new Map<string, Promise<void>>()
  // Why the Time Log could not be read last time, if it could not.
  #readProblem: string | null = null

  constructor(protected deps: DaysDeps) {}

  #now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  #today(): string {
    return dayKey(this.#now())
  }

  get #store() {
    return this.deps.store
  }

  // ---------- what the core says

  // The user's signals between two days (both included), oldest first.
  async #signals(from: string, to: string): Promise<WorkEvent[]> {
    const since = dayStart(from).toISOString()
    const until = dayStart(addDays(to, 1)).toISOString()
    const events = await this.deps.work.events(since, until)
    return events.sort((a, b) => a.at.localeCompare(b.at))
  }

  // The tasks with a commit on one of their branches, deleted ones included, in the window git is read over (35 days) up to
  // the day's end: the work on them began, whatever the day shown has. Without the day's own signals the Time Log's line
  // that an hand wrote still gets its answer.
  async #started(day: string, branches: Map<string, BranchInfo> | null): Promise<string[]> {
    const since = dayStart(addDays(day, -LOG_WINDOW_DAYS)).toISOString()
    const until = dayStart(addDays(day, 1)).toISOString()
    const events = await this.deps.work.events(since, until)
    const tasks = new Set<string>()
    for (const e of events) {
      if (e.kind !== 'commit') continue
      const branch = e.repo && e.branch ? branches?.get(placeKey(e.repo, e.branch)) : undefined
      const taskId = branch?.taskId ?? e.taskId
      if (taskId) tasks.add(taskId)
    }
    return [...tasks].sort()
  }

  async #input(day: string, s: TempsSettings): Promise<DayInput> {
    const { work } = this.deps
    const [branches, repos, events] = await Promise.all([work.branches(), work.repos(), this.#signals(day, day)])
    const labels = new Map(repos.map((r) => [r.path, r.label]))
    // The branches git has, and, for the ones it forgot (merged, then deleted), the task they had when it knew them.
    await this.#store.rememberBranches(branches.map((b) => ({ repo: b.repo, branch: b.name, taskId: b.taskId })))
    const known = new Map<string, BranchInfo>()
    for (const r of await this.#store.rememberedBranches()) known.set(placeKey(r.repo, r.branch), { taskId: r.taskId, isDefault: false })
    for (const b of branches) known.set(placeKey(b.repo, b.name), { taskId: b.taskId, isDefault: b.isDefault })
    return {
      events,
      branches: known,
      repoLabel: (repo) => labels.get(repo) ?? repo,
      integration: integrationOf(s.integrationBranches, s.deployBranches),
    }
  }

  async #log(): Promise<DayLog | null> {
    return this.deps.timeLog().catch(() => null)
  }

  // Why the day cannot be sent to the Time Log as it is, or null.
  async #logProblem(): Promise<string | null> {
    const log = await this.#log()
    if (!log) return NO_LOG
    if (!(await log.configured().catch(() => false))) return `Le Time Log de ${log.name} n'est pas configuré`
    if (this.#readProblem) return this.#readProblem
    return sends(log) ? null : noWholeDay(log.name)
  }

  // Without them (a provider that does not say them), the labels already used are offered, and no other property.
  async #fields(): Promise<LogFields> {
    const log = await this.#log()
    if (!log?.fields) return { labels: [], extras: [] }
    return log.fields().catch(() => ({ labels: [], extras: [] }))
  }

  /**
   * Reads the user's Time Log for a period into the mirror, unless it was read lately. A period within the window
   * (35 days back, some ahead) is read as the whole window.
   */
  async readLog(from: string, to: string, force = false): Promise<void> {
    const log = await this.#log()
    if (!reads(log) || !(await log.configured().catch(() => false))) return
    const today = this.#today()
    const start = addDays(today, -LOG_WINDOW_DAYS)
    const end = addDays(today, LOG_AHEAD_DAYS)
    const [a, b] = from >= start && to <= end ? [start, end] : [from, to]
    const key = `${a}|${b}`
    if (!force && Date.now() - (this.#readAt.get(key) ?? 0) < FRESH_MS) return
    // The page asks for a day, a week and the summary at once: they wait for the one read going on, not for an empty
    // mirror (the day would show as « to validate » while the Time Log has it).
    const going = this.#reading.get(key)
    if (going && !force) return going
    const read = this.#readInto(log, a, b, key).finally(() => {
      if (this.#reading.get(key) === read) this.#reading.delete(key)
    })
    this.#reading.set(key, read)
    return read
  }

  async #readInto(log: ReadingLog, from: string, to: string, key: string): Promise<void> {
    try {
      const entries = await log.read(from, to)
      await this.#store.recordLog(entries.map(logRowOf), from, to)
      this.#readAt.set(key, Date.now())
      this.#readProblem = null
    } catch (err) {
      this.#readProblem = `Time Log non relu : ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // ---------- the proposal

  // One line per task (or orphan branch, or the deployments) in proportion to the activity.
  async proposal(day: string, s: TempsSettings): Promise<NewDraftRow[]> {
    const activities = reconstruct(day, await this.#input(day, s), this.#now())
    const shares = proposeShares(activities.map((a) => a.weight))
    const logged = await this.#store.lastLogged()
    const lines = activities.map((a, i): NewDraftRow => {
      const last = a.taskId ? logged.get(a.taskId) : undefined
      const deploy = a.key === DEPLOY_KEY
      return {
        taskId: a.taskId,
        repo: a.repo,
        branch: a.branch,
        label: deploy ? s.deployLabel : last?.label || s.defaultLabel,
        props: last?.props ?? {},
        share: shares[i],
        tiny: a.weight > 0 && shares[i] === 0,
        confirmed: deploy,
        reason: a.reason,
      }
    })
    return lines.sort((a, b) => b.share - a.share)
  }

  /**
   * Brings a day's draft up to date. A day the Time Log already has gets no automatic draft; a draft the user edited
   * is left alone; any other day follows the signals (the computation is deterministic).
   */
  async refreshDraft(day: string): Promise<void> {
    if (day > this.#today()) return
    if (await this.#store.edited(day)) return
    const logged = await this.#store.logged([day])
    await this.#store.writeDraft(day, logged.length ? [] : await this.proposal(day, await this.deps.settings()))
  }

  // ---------- the days' states

  // Reads once what the states of these days depend on, and gives the state of any of them.
  async stateReader(days: string[]): Promise<(day: string) => DayState> {
    const s = await this.deps.settings()
    const today = this.#today()
    const sorted = [...days].sort()
    const [logged, withDraft, editedDays, events] = await Promise.all([
      this.#store.logged(days),
      this.#store.daysWithDraft(days),
      this.#store.editedDays(days),
      this.#signals(sorted[0], sorted[sorted.length - 1]).catch((): WorkEvent[] => []),
    ])
    const active = new Set(events.map((e) => localDay(e.at)))
    return (day) => {
      const rows = logged.filter((r) => r.day === day)
      // What the Time Log has comes first, even for a day to come (a planned absence).
      if (rows.length && editedDays.has(day) && withDraft.has(day)) return 'modified'
      if (rows.length === 1 && !rows[0].taskId && rows[0].label === s.absentLabel) return 'absent'
      if (rows.length) return 'recorded'
      if (day > today) return 'future'
      if (withDraft.has(day) || active.has(day)) return 'to_validate'
      if (!s.workDays.has(isoWeekday(day))) return 'off'
      if (day < today) return 'to_fill'
      return 'empty'
    }
  }

  async dayState(day: string): Promise<DayState> {
    return (await this.stateReader([day]))(day)
  }

  // Each day with its state and its total in twentieths: the Time Log's for a recorded day, the draft's otherwise.
  async summaries(days: string[]): Promise<DaySummary[]> {
    const stateOf = await this.stateReader(days)
    const states = days.map((day) => ({ day, state: stateOf(day) }))
    const fromLog = states.filter((d) => d.state === 'recorded' || d.state === 'absent').map((d) => d.day)
    const totals = new Map(days.map((d) => [d, 0]))
    for (const r of await this.#store.logged(fromLog)) totals.set(r.day, (totals.get(r.day) ?? 0) + r.share)
    for (const day of days.filter((d) => !fromLog.includes(d))) {
      for (const r of await this.#store.drafts(day)) totals.set(day, (totals.get(day) ?? 0) + r.share)
    }
    return states.map(({ day, state }) => ({ day, state, total: totals.get(day) ?? 0 }))
  }

  // ---------- the day

  async view(day: string): Promise<DayView> {
    await this.readLog(day, day)
    await this.refreshDraft(day)
    const s = await this.deps.settings()
    const state = await this.dayState(day)
    const fromLog = state === 'recorded' || state === 'absent'
    const logged = fromLog ? await this.#store.logged([day]) : []
    const drafts = fromLog ? [] : await this.#store.drafts(day)
    const lines: DayLine[] = fromLog
      ? logged.map((r) => ({
          id: r.id,
          key: lineKeyOf({ ...r, repo: null, branch: null }),
          source: 'log',
          taskId: r.taskId,
          label: r.label,
          share: r.share,
          repo: null,
          branch: null,
          tiny: false,
          confirmed: true,
          reason: '',
          url: r.url,
          props: r.props,
        }))
      : drafts.map((d) => ({
          id: String(d.id),
          key: lineKeyOf(d),
          source: 'draft',
          taskId: d.taskId,
          label: d.label,
          share: d.share,
          repo: d.repo,
          branch: d.branch,
          tiny: d.tiny,
          confirmed: d.confirmed,
          reason: d.reason,
          url: null,
          props: d.props,
        }))
    // The day's signals, each with the line it supports: the evidence behind the proposal. What counts for nothing
    // (a checkout of an integration branch) supports no line.
    const input = await this.#input(day, s).catch(() => null)
    const signals = (input?.events ?? []).flatMap((e) => {
      if (!input) return []
      const key = lineOf(e, input.branches, input.integration)
      if (!key) return []
      return {
        minute: minuteOf(e.at),
        kind: e.kind,
        key: key === DEPLOY_KEY ? `none:${s.deployLabel}` : key,
        repo: e.repo,
        branch: e.branch,
        detail: e.detail,
      }
    })
    const started = await this.#started(day, input?.branches ?? null).catch((): string[] => [])
    const fields = await this.#fields()
    // The labels offered for a line: the Time Log's; without them, those already used, the default and absence ones.
    const used = fields.labels.length ? [] : await this.#store.usedLabels()
    const labels = [
      ...new Set([
        ...fields.labels,
        ...(fields.labels.length ? [] : [s.defaultLabel, s.absentLabel]),
        ...used,
        ...lines.map((l) => l.label),
      ]),
    ].filter(Boolean)
    return {
      day,
      isToday: day === this.#today(),
      state,
      total: lines.reduce((a, l) => a + l.share, 0),
      sentAt:
        logged
          .map((r) => r.lastEdited)
          .filter((at): at is string => Boolean(at))
          .sort()
          .at(-1) ?? null,
      lines,
      signals,
      started,
      labels,
      defaultLabel: s.defaultLabel,
      extras: fields.extras,
      logProblem: await this.#logProblem(),
    }
  }

  // ---------- the user's actions

  // « Modifier »: the day's Time Log lines become a draft the user can change and send again.
  async edit(day: string): Promise<void> {
    const logged = await this.#store.logged([day])
    await this.#store.writeDraft(
      day,
      logged.map((r) => ({ taskId: r.taskId, label: r.label, share: r.share, props: r.props, confirmed: true })),
      true
    )
    this.deps.changed()
  }

  // Drops the user's draft: the day goes back to the Time Log's lines, or to the proposal.
  async discard(day: string): Promise<void> {
    await this.#store.writeDraft(day, [], false)
    await this.refreshDraft(day)
    this.deps.changed()
  }

  // « Recalculer »: back to the proposal; on a recorded day, the proposal becomes a draft to send.
  async recompute(day: string): Promise<void> {
    const logged = await this.#store.logged([day])
    if (!logged.length) return this.discard(day)
    await this.#store.writeDraft(day, await this.proposal(day, await this.deps.settings()), true)
    this.deps.changed()
  }

  // A draft is saved whatever its total: a day must make 1 only to be sent.
  async replace(day: string, lines: LineInput[]): Promise<void> {
    const seen = new Set<string>()
    for (const l of lines) {
      const id = identity(l)
      if (seen.has(id)) throw new DraftError(`La même tâche apparaît deux fois avec l'étiquette « ${l.label} »`)
      seen.add(id)
    }
    await this.#store.writeDraft(
      day,
      lines.map((l) => ({
        taskId: l.taskId,
        label: l.label,
        share: l.share,
        repo: l.taskId ? null : (l.repo ?? null),
        branch: l.taskId ? null : (l.branch ?? null),
        confirmed: Boolean(l.confirmed),
        props: l.props ?? {},
      })),
      true
    )
    this.deps.changed()
  }

  /**
   * Settles a line without a task: attached to a task (which also links its git branch, so the other days follow, unless
   * the user unlinked that branch by hand: it stays so), or kept without a task. An attached line joins the task's line
   * of the same label.
   */
  async resolve(day: string, id: number, change: { taskId?: string; confirmed?: boolean }): Promise<void> {
    const rows = await this.#store.drafts(day)
    const line = rows.find((r) => r.id === id)
    if (!line) throw new DraftError('Ligne inconnue')
    let next: DraftRow[] = rows
    if (change.taskId) {
      const taskId = change.taskId
      if (line.repo && line.branch) {
        const { work } = this.deps
        const branch = (await work.branches()).find((b) => b.repo === line.repo && b.name === line.branch)
        if (branch && !branch.isDefault && !branch.taskId && !branch.noTask) await work.link(line.repo, line.branch, taskId)
      }
      const twin = rows.find((r) => r.id !== line.id && r.taskId === taskId && r.label === line.label)
      next = twin
        ? rows.filter((r) => r.id !== line.id).map((r) => (r === twin ? { ...r, share: r.share + line.share } : r))
        : rows.map((r) => (r === line ? { ...r, taskId, repo: null, branch: null, confirmed: true } : r))
    } else if (change.confirmed) {
      next = rows.map((r) => (r === line ? { ...r, confirmed: true } : r))
    }
    await this.#store.writeDraft(day, next, true)
    this.deps.changed()
  }

  // « Absent »: the whole day becomes one line without a task, with the absence label.
  async absent(day: string): Promise<void> {
    const s = await this.deps.settings()
    await this.#store.writeDraft(day, [{ taskId: null, label: s.absentLabel, share: DAY_SHARES, confirmed: true }], true)
    this.deps.changed()
  }

  /**
   * Sends a day's draft to the Time Log: lines of the same task (or none) and label merge, lines at 0 go; the Time Log
   * rewrites the day's entry of each (task, label) and removes the day's others, then the mirror holds what it
   * answered and the draft is gone.
   */
  async send(day: string): Promise<{ written: number }> {
    const log = await this.#log()
    if (!log) throw new DraftError(NO_LOG)
    if (!sends(log)) throw new DraftError(noWholeDay(log.name))
    if (!(await log.configured())) throw new DraftError(`Le Time Log de ${log.name} n'est pas configuré`)
    const drafts = await this.#store.drafts(day)
    const total = drafts.reduce((a, d) => a + d.share, 0)
    if (total !== DAY_SHARES) throw new DraftError(`La journée doit valoir 1 (${String(total / DAY_SHARES).replace('.', ',')})`)
    if (drafts.some((d) => !d.taskId && d.branch && !d.confirmed)) {
      throw new DraftError('Une branche sans tâche reste à rattacher ou à garder sans tâche')
    }
    const [tasks, { taskText }] = await Promise.all([
      this.deps.work.tasks().catch(() => new Map<string, WorkTask>()),
      this.deps.settings(),
    ])
    // A task as the line gives it: its title, and the text the Time Log writes when it cannot relate the entry to it.
    const taskOf = (id: string, label: string) => {
      const task = tasks.get(id)
      const title = task?.title ?? label
      const text = task ? fillTaskText(taskText, task) : ''
      return text ? { id, title, text } : { id, title }
    }
    const merged = new Map<string, LogLine>()
    for (const d of drafts) {
      if (!d.share) continue
      const key = `${d.taskId ?? ''}\u0000${d.label}`
      const line = merged.get(key)
      if (line) line.share += d.share / DAY_SHARES
      else {
        merged.set(key, {
          task: d.taskId ? taskOf(d.taskId, d.label) : null,
          label: d.label || null,
          share: d.share / DAY_SHARES,
          props: d.props,
        })
      }
    }
    // Twentieths added as fractions: written as Notion reads them back (0.35, not 0.35000000000000003).
    const lines = [...merged.values()].map((l) => ({ ...l, share: Math.round(l.share * DAY_SHARES) / DAY_SHARES }))
    const entries = await log.sendDay(day, lines)
    await this.#store.recordLog(entries.map(logRowOf), day, day)
    await this.#store.writeDraft(day, [], false)
    this.deps.changed()
    return { written: entries.length }
  }

  // ---------- the lists

  // The 7 days of the week holding `day`, Monday first.
  async week(day: string): Promise<DaySummary[]> {
    const monday = addDays(day, -((dayStart(day).getDay() + 6) % 7))
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    await this.readLog(days[0], days[6])
    return this.summaries(days)
  }

  async month(year: number, month: number): Promise<DaySummary[]> {
    const count = new Date(year, month, 0).getDate()
    const days = Array.from({ length: count }, (_, i) => dayKey(new Date(year, month - 1, i + 1)))
    await this.readLog(days[0], days[days.length - 1])
    return this.summaries(days)
  }

  // What the tab and the banner say: today's state, the days still to deal with among the last 7.
  async summary(): Promise<Summary> {
    const today = this.#today()
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
    await this.readLog(days[0], today)
    const stateOf = await this.stateReader(days)
    return {
      todayState: stateOf(today),
      pendingDays: days.filter((d) => ['to_validate', 'modified', 'to_fill'].includes(stateOf(d))).length,
      workDays: [...(await this.deps.settings()).workDays].sort(),
    }
  }

  // The work moved on (a commit, a task changed): today's proposal follows, and the Time Log is read again.
  async follow(): Promise<void> {
    const today = this.#today()
    await this.readLog(today, today)
    await this.refreshDraft(today)
    this.deps.changed()
  }
}

