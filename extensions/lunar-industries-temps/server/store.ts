import type { ServerContext } from '@bidule/api/extensions'
import type { StoredType } from '@bidule/sdk/objects'
import type { Props } from '../contract.ts'

// A line of a day's draft (shares in twentieths).
export type DraftRow = {
  id: number
  day: string
  taskId: string | null
  label: string
  repo: string | null
  branch: string | null
  share: number
  tiny: boolean
  confirmed: boolean
  reason: string
  props: Props
}
export type NewDraftRow = Omit<DraftRow, 'id' | 'day' | 'tiny' | 'reason' | 'repo' | 'branch' | 'props'> &
  Partial<Pick<DraftRow, 'tiny' | 'reason' | 'repo' | 'branch' | 'props'>>

// An entry of the user's Time Log, as the Time Log answered (shares in twentieths).
export type LogRow = {
  id: string
  day: string
  taskId: string | null
  label: string
  share: number
  url: string | null
  props: Props
  lastEdited: string | null
}

/** What the module keeps: the drafts, which days are the user's, the mirror of the Time Log. */
export interface TempsStore {
  drafts(day: string): Promise<DraftRow[]>
  // The days among these that have a draft.
  daysWithDraft(days: string[]): Promise<Set<string>>
  // Replaces a day's draft; `edited` also says whether it is the user's now.
  writeDraft(day: string, rows: NewDraftRow[], edited?: boolean): Promise<void>
  edited(day: string): Promise<boolean>
  editedDays(days: string[]): Promise<Set<string>>
  setEdited(day: string, edited: boolean): Promise<void>
  // The Time Log's entries still there, of a day or of several.
  logged(days: string[]): Promise<LogRow[]>
  // For each task, what the user last logged on it (its label and properties become the proposal).
  lastLogged(): Promise<Map<string, { label: string; props: Props }>>
  usedLabels(): Promise<string[]>
  // Makes the mirror match what the Time Log has for a period: entries read are stored as they are, the period's
  // others hidden (archived, moved to another day).
  recordLog(entries: LogRow[], from: string, to: string): Promise<void>
  // The task of each branch seen linked to one. Git forgets a branch deleted, and with it its events' task: the past
  // commits of a merged branch would turn into « a branch without a task » (and a day not edited would change).
  rememberBranches(live: { repo: string; branch: string; taskId: string | null }[]): Promise<void>
  rememberedBranches(): Promise<{ repo: string; branch: string; taskId: string }[]>
  // An object of the core merged into another (objects.merged): what is kept under its id goes to the one left.
  followMerge(type: StoredType, from: string, into: string): Promise<void>
}

// What the module does when the core says two objects are one (objects.merged): the ids kept here go to the one left,
// then `then` (today's proposal follows), which the core waits for.
export function mergeListener(store: Pick<TempsStore, 'followMerge'>, then: () => Promise<void>) {
  return async ({ type, from, into }: { type: StoredType; from: string; into: string }): Promise<void> => {
    await store.followMerge(type, from, into)
    await then()
  }
}

// Rows per insert, well under the 500 terms SQLite accepts in a compound SELECT.
const INSERT_CHUNK = 100
const DRAFTS = 'lunar_industries_temps_drafts'
const BRANCH_TASKS = 'lunar_industries_temps_branch_tasks'
const DAYS = 'lunar_industries_temps_days'
const LOG = 'lunar_industries_temps_log'

// The columns of each table, as the database gives them back (the query builder answers untyped: the rows are
// annotated where they are read).
type DraftColumns = {
  id: number
  day: string
  task_id: string | null
  label: string | null
  repo: string | null
  branch: string | null
  share: number | null
  tiny: number | null
  confirmed: number | null
  reason: string | null
  props: string | null
}
type LogColumns = {
  id: string
  day: string
  task_id: string | null
  label: string | null
  share: number | null
  url: string | null
  props: string | null
  last_edited: string | null
}
type DayColumns = { day: string; edited: number | null }
type LabelColumns = { label: string | null }
type BranchTaskColumns = { repo: string; branch: string; task_id: string }

export function parseProps(json: string | null): Props {
  try {
    const value: unknown = JSON.parse(json ?? '{}')
    // A line's properties, as the Time Log's own (an object, never a list).
    const props: Props = value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
    return props
  } catch {
    return {}
  }
}

const draftOf = (r: DraftColumns): DraftRow => ({
  id: r.id,
  day: r.day,
  taskId: r.task_id,
  label: r.label ?? '',
  repo: r.repo,
  branch: r.branch,
  share: r.share ?? 0,
  tiny: Boolean(r.tiny),
  confirmed: Boolean(r.confirmed),
  reason: r.reason ?? '',
  props: parseProps(r.props),
})

const logOf = (r: LogColumns): LogRow => ({
  id: r.id,
  day: r.day,
  taskId: r.task_id,
  label: r.label ?? '',
  share: r.share ?? 0,
  url: r.url,
  props: parseProps(r.props),
  lastEdited: r.last_edited,
})

export class DbStore implements TempsStore {
  constructor(protected db: ServerContext['db']) {}

  async drafts(day: string): Promise<DraftRow[]> {
    const rows: DraftColumns[] = await this.db.from(DRAFTS).where('day', day).orderBy('share', 'desc').orderBy('id')
    return rows.map(draftOf)
  }

  async daysWithDraft(days: string[]): Promise<Set<string>> {
    if (!days.length) return new Set()
    const rows: Pick<DayColumns, 'day'>[] = await this.db.from(DRAFTS).whereIn('day', days).distinct('day')
    return new Set(rows.map((r) => r.day))
  }

  async writeDraft(day: string, rows: NewDraftRow[], edited?: boolean): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx.from(DRAFTS).where('day', day).delete()
      const lines = rows.map((r) => ({
        day,
        task_id: r.taskId,
        label: r.label,
        repo: r.repo ?? null,
        branch: r.branch ?? null,
        share: r.share,
        tiny: r.tiny ? 1 : 0,
        confirmed: r.confirmed ? 1 : 0,
        reason: r.reason ?? '',
        props: JSON.stringify(r.props ?? {}),
      }))
      // One insert of many rows becomes a compound SELECT, which SQLite refuses beyond 500 terms.
      for (let from = 0; from < lines.length; from += INSERT_CHUNK) {
        await trx.table(DRAFTS).multiInsert(lines.slice(from, from + INSERT_CHUNK))
      }
      if (edited !== undefined) {
        await trx.table(DAYS).insert({ day, edited: edited ? 1 : 0 }).onConflict('day').merge()
      }
    })
  }

  async edited(day: string): Promise<boolean> {
    const row: DayColumns | null = await this.db.from(DAYS).where('day', day).first()
    return Boolean(row?.edited)
  }

  async editedDays(days: string[]): Promise<Set<string>> {
    if (!days.length) return new Set()
    const rows: DayColumns[] = await this.db.from(DAYS).whereIn('day', days).where('edited', 1)
    return new Set(rows.map((r) => r.day))
  }

  async setEdited(day: string, edited: boolean): Promise<void> {
    await this.db.table(DAYS).insert({ day, edited: edited ? 1 : 0 }).onConflict('day').merge()
  }

  async logged(days: string[]): Promise<LogRow[]> {
    if (!days.length) return []
    const rows: LogColumns[] = await this.db.from(LOG).whereNull('deleted_at').whereIn('day', days).orderBy('share', 'desc')
    return rows.map(logOf)
  }

  async lastLogged(): Promise<Map<string, { label: string; props: Props }>> {
    const rows: LogColumns[] = await this.db.from(LOG).whereNull('deleted_at').whereNotNull('task_id').orderBy('day', 'desc')
    const out = new Map<string, { label: string; props: Props }>()
    for (const r of rows.map(logOf)) {
      if (r.taskId && !out.has(r.taskId)) out.set(r.taskId, { label: r.label, props: r.props })
    }
    return out
  }

  async usedLabels(): Promise<string[]> {
    const rows: LabelColumns[] = await this.db.from(LOG).whereNull('deleted_at').distinct('label')
    return rows.map((r) => r.label ?? '').filter(Boolean)
  }

  async recordLog(entries: LogRow[], from: string, to: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (const e of entries) {
        await trx
          .table(LOG)
          .insert({
            id: e.id,
            day: e.day,
            task_id: e.taskId,
            label: e.label,
            share: e.share,
            url: e.url,
            props: JSON.stringify(e.props),
            last_edited: e.lastEdited,
            deleted_at: null,
          })
          .onConflict('id')
          .merge()
      }
      await trx
        .from(LOG)
        .whereNull('deleted_at')
        .where('day', '>=', from)
        .where('day', '<=', to)
        .whereNotIn(
          'id',
          entries.map((e) => e.id)
        )
        .update({ deleted_at: new Date().toISOString() })
    })
  }

  async rememberBranches(live: { repo: string; branch: string; taskId: string | null }[]): Promise<void> {
    const known = new Map((await this.rememberedBranches()).map((r) => [`${r.repo}\u0000${r.branch}`, r.taskId]))
    const changes = live.filter((b) => (known.get(`${b.repo}\u0000${b.branch}`) ?? null) !== b.taskId)
    if (!changes.length) return
    await this.db.transaction(async (trx) => {
      for (const { repo, branch, taskId } of changes) {
        // A branch still there and no longer linked is not one of the task: what git says now wins.
        if (taskId === null) await trx.from(BRANCH_TASKS).where({ repo, branch }).delete()
        else await trx.table(BRANCH_TASKS).insert({ repo, branch, task_id: taskId }).onConflict(['repo', 'branch']).merge()
      }
    })
  }

  async rememberedBranches(): Promise<{ repo: string; branch: string; taskId: string }[]> {
    const rows: BranchTaskColumns[] = await this.db.from(BRANCH_TASKS)
    return rows.map((r) => ({ repo: r.repo, branch: r.branch, taskId: r.task_id }))
  }

  // A task: the drafts, the branches remembered and the mirror. An entry: the mirror, by its id (when it has both, the
  // one left stays).
  async followMerge(type: StoredType, from: string, into: string): Promise<void> {
    if (type === 'task') {
      await this.db.transaction(async (trx) => {
        for (const table of [DRAFTS, BRANCH_TASKS, LOG]) await trx.from(table).where('task_id', from).update({ task_id: into })
      })
    } else if (type === 'timeEntry') {
      const kept: LogColumns | null = await this.db.from(LOG).where('id', into).first()
      if (kept) await this.db.from(LOG).where('id', from).delete()
      else await this.db.from(LOG).where('id', from).update({ id: into })
    }
  }
}
