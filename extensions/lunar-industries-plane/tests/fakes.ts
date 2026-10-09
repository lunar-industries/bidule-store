import type {
  PlaneApi,
  PlaneComment,
  PlaneMember,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
} from '../server/client.ts'
import type { MirrorTask, PlaneMirror, StatusChange } from '../server/mirror.ts'
import type { PlaneColumn } from '../server/states.ts'
import { PlaneTasks, type PlaneConfig } from '../server/source.ts'

export class MemoryMirror implements PlaneMirror {
  columnList: PlaneColumn[] = []
  rows = new Map<string, MirrorTask & { gone: boolean }>()
  changes: { at: string; taskId: string; from: string; to: string }[] = []
  editList: { at: string; taskId: string; detail: string }[] = []

  async replaceColumns(columns: PlaneColumn[]) {
    this.columnList = columns
  }
  async columns() {
    return this.columnList
  }
  async tasks() {
    return [...this.rows.values()].filter((r) => !r.gone).sort((a, b) => a.title.localeCompare(b.title))
  }
  async task(id: string) {
    const row = this.rows.get(id)
    return row && !row.gone ? row : null
  }
  async upsert(task: MirrorTask) {
    this.rows.set(task.id, { ...task, gone: false })
  }
  async setStatus(id: string, status: string) {
    const row = this.rows.get(id)
    if (row) row.status = status
  }
  async keepOnly(ids: Set<string>) {
    for (const row of this.rows.values()) if (!ids.has(row.id)) row.gone = true
  }
  async addStatusChange(at: string, taskId: string, from: string, to: string) {
    this.changes.push({ at, taskId, from, to })
  }
  async statusChanges(since: string, until: string): Promise<StatusChange[]> {
    const groups = new Map(this.columnList.map((c) => [c.name, c.group]))
    return this.changes
      .filter((c) => c.at >= since && c.at < until)
      .map((c) => ({ ...c, fromGroup: groups.get(c.from) ?? null, toGroup: groups.get(c.to) ?? null }))
  }
  async addEdit(at: string, taskId: string, detail: string) {
    this.editList.push({ at, taskId, detail })
  }
  async edits(since: string, until: string) {
    return this.editList.filter((e) => e.at >= since && e.at < until)
  }
}

export const state = (id: string, name: string, group: string, sequence = 1): PlaneState => ({
  id,
  name,
  group,
  color: '#abcdef',
  sequence,
})

export const item = (id: string, name: string, extra: Partial<PlaneWorkItem> = {}): PlaneWorkItem => ({
  id,
  project: 'p1',
  sequenceId: 1,
  name,
  state: 's-todo',
  assignees: ['me'],
  descriptionHtml: null,
  targetDate: null,
  completedAt: null,
  updatedAt: '2026-10-06T08:00:00.000Z',
  updatedBy: 'me',
  ...extra,
})

export const STATES = [
  state('s-backlog', 'Backlog', 'backlog', 1),
  state('s-todo', 'À faire', 'unstarted', 2),
  state('s-doing', 'En cours', 'started', 3),
  state('s-review', 'En revue', 'started', 4),
  state('s-done', 'Terminé', 'completed', 5),
]

// A fake Plane: one project (ACC) holding the work items, and the calls made to it.
export function fakePlane(items: PlaneWorkItem[] = []) {
  const project: PlaneProject = { id: 'p1', name: 'Accenta', identifier: 'ACC' }
  const calls: string[] = []
  const comments: { item: string; html: string }[] = []
  const world = {
    items,
    states: STATES,
    projects: [project],
    members: [
      { id: 'me', displayName: 'Simon', firstName: null, lastName: null, email: 'simon@x.fr' },
      { id: 'u2', displayName: null, firstName: 'Camille', lastName: 'Durand', email: 'camille@x.fr' },
    ] satisfies PlaneMember[],
  }
  const api: PlaneApi = {
    async me(): Promise<PlaneUser> {
      return { id: 'me', displayName: 'Simon', email: 'simon@x.fr' }
    },
    async projects() {
      return world.projects
    },
    async states() {
      return world.states
    },
    async workItems() {
      return world.items
    },
    async workItem(_slug, _project, id) {
      const found = world.items.find((i) => i.id === id)
      if (!found) throw new Error(`work item ${id} inconnu`)
      return found
    },
    async comments(): Promise<PlaneComment[]> {
      return [
        { id: 'c1', html: '<p>Premier</p>', stripped: null, createdAt: '2026-10-05T10:00:00Z' },
        { id: 'c2', html: null, stripped: 'Deuxième', createdAt: '2026-10-05T11:00:00Z' },
      ]
    },
    async addComment(_slug, _project, id, html) {
      comments.push({ item: id, html })
    },
    async members() {
      return world.members
    },
    async setState(_slug, _project, id, stateId) {
      calls.push(`setState ${id} ${stateId}`)
      const found = world.items.find((i) => i.id === id)
      if (found) found.state = stateId
    },
  }
  return { api, world, calls, comments }
}

export const CONFIG: PlaneConfig = { url: 'plane.test', workspace: 'accenta', projects: [], key: 'secret' }

// The source over a fake Plane and an empty mirror.
export function source(plane = fakePlane(), options: { config?: Partial<PlaneConfig> } = {}) {
  const mirror = new MemoryMirror()
  const tasks = new PlaneTasks(
    async () => ({ ...CONFIG, ...options.config }),
    mirror,
    () => plane.api
  )
  return { tasks, mirror, plane }
}
