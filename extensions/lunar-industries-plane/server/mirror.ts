import type { Database } from '@adonisjs/lucid/database'
import type { StatusChange, TaskColumn, TaskGroup } from '@bidule/sdk/tasks'

// A work item as the mirror keeps it.
export interface MirrorTask {
  id: string
  project: string
  title: string
  status: string
  ref: string | null
  url: string | null
  lastEdited: string | null
  due: string | null
  // The Notion page ids its description names.
  notionIds: string[]
}

/** What the extension keeps of Plane between two syncs. */
export interface PlaneMirror {
  replaceColumns(columns: TaskColumn[]): Promise<void>
  columns(): Promise<TaskColumn[]>
  // The user's work items, by title.
  tasks(): Promise<MirrorTask[]>
  task(id: string): Promise<MirrorTask | null>
  upsert(task: MirrorTask): Promise<void>
  setStatus(id: string, status: string): Promise<void>
  // The user's work items are exactly these now: the others are hidden.
  keepOnly(ids: Set<string>): Promise<void>
  addStatusChange(at: string, taskId: string, from: string, to: string): Promise<void>
  // The user's changes of their work items' states between two times, with the groups of the columns as they are now.
  statusChanges(since: string, until: string): Promise<StatusChange[]>
  addEdit(at: string, taskId: string, detail: string): Promise<void>
  edits(since: string, until: string): Promise<{ at: string; taskId: string }[]>
}

type TaskRow = {
  id: string
  project_id: string
  title: string
  status: string
  ref: string | null
  url: string | null
  last_edited: string | null
  due: string | null
  notion_ids: string
}

function idsIn(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

const groupIn = (value: unknown): TaskGroup => (value === 'doing' || value === 'done' ? value : 'todo')

const taskOf = (row: TaskRow): MirrorTask => ({
  id: row.id,
  project: row.project_id,
  title: row.title,
  status: row.status,
  ref: row.ref,
  url: row.url,
  lastEdited: row.last_edited,
  due: row.due,
  notionIds: idsIn(row.notion_ids),
})

// Everything this extension writes, in its own tables (lunar_industries_plane_…).
export class DbMirror implements PlaneMirror {
  constructor(protected db: Database) {}

  async replaceColumns(columns: TaskColumn[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx.from('lunar_industries_plane_columns').delete()
      if (columns.length) {
        await trx
          .table('lunar_industries_plane_columns')
          .multiInsert(columns.map((c, position) => ({ name: c.name, grp: c.group, color: c.color, position })))
      }
    })
  }

  async columns(): Promise<TaskColumn[]> {
    const rows = await this.db.from('lunar_industries_plane_columns').orderBy('position')
    return rows.map((r) => ({ name: r.name, color: r.color, group: groupIn(r.grp) }))
  }

  async tasks(): Promise<MirrorTask[]> {
    const rows: TaskRow[] = await this.db.from('lunar_industries_plane_tasks').whereNull('deleted_at').orderBy('title')
    return rows.map(taskOf)
  }

  async task(id: string): Promise<MirrorTask | null> {
    const row: TaskRow | null = await this.db.from('lunar_industries_plane_tasks').where('id', id).whereNull('deleted_at').first()
    return row ? taskOf(row) : null
  }

  async upsert(task: MirrorTask): Promise<void> {
    await this.db
      .table('lunar_industries_plane_tasks')
      .insert({
        id: task.id,
        project_id: task.project,
        title: task.title,
        status: task.status,
        ref: task.ref,
        url: task.url,
        last_edited: task.lastEdited,
        due: task.due,
        notion_ids: JSON.stringify(task.notionIds),
        deleted_at: null,
      })
      .onConflict('id')
      .merge()
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.db.from('lunar_industries_plane_tasks').where('id', id).update({ status })
  }

  async keepOnly(ids: Set<string>): Promise<void> {
    await this.db
      .from('lunar_industries_plane_tasks')
      .whereNull('deleted_at')
      .whereNotIn('id', [...ids])
      .update({ deleted_at: new Date().toISOString() })
  }

  async addStatusChange(at: string, taskId: string, from: string, to: string): Promise<void> {
    await this.db
      .table('lunar_industries_plane_status_changes')
      .insert({ at, task_id: taskId, from, to })
      .onConflict(['at', 'task_id'])
      .ignore()
  }

  async statusChanges(since: string, until: string): Promise<StatusChange[]> {
    const groups = new Map((await this.columns()).map((c) => [c.name, c.group]))
    const rows = await this.db
      .from('lunar_industries_plane_status_changes')
      .where('at', '>=', since)
      .where('at', '<', until)
      .orderBy('at')
    return rows.map((r) => ({
      at: r.at,
      taskId: r.task_id,
      from: r.from,
      to: r.to,
      fromGroup: groups.get(r.from) ?? null,
      toGroup: groups.get(r.to) ?? null,
    }))
  }

  async addEdit(at: string, taskId: string, detail: string): Promise<void> {
    await this.db.table('lunar_industries_plane_edits').insert({ at, task_id: taskId, detail }).onConflict(['at', 'task_id']).ignore()
  }

  async edits(since: string, until: string): Promise<{ at: string; taskId: string }[]> {
    const rows = await this.db.from('lunar_industries_plane_edits').where('at', '>=', since).where('at', '<', until).orderBy('at')
    return rows.map((r) => ({ at: r.at, taskId: r.task_id }))
  }
}
