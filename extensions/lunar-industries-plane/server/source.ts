import type { TaskPage, TaskPerson } from '@bidule/sdk/objects'
import {
  PlaneClient,
  planeBase,
  type PlaneApi,
  type PlaneMember,
  type PlaneProject,
  type PlaneState,
  type PlaneWorkItem,
} from './client.ts'
import type { MirrorTask, PlaneMirror } from './mirror.ts'
import { columnsOf, notionIdsOf, pickState, refOf, webUrl, wantedProjects } from './states.ts'
import { htmlToText, textToHtml } from './text.ts'

/** What the settings say: the instance, the workspace, the projects to read, and the key (from the keychain). */
export type PlaneConfig = { url: string; workspace: string; projects: string[]; key: string }

type Access = { api: PlaneApi; base: string; workspace: string }

/**
 * The work items assigned to the user in a Plane workspace, kept in the mirror a sync fills (server/index.ts puts
 * them in the core as `task` objects, beside Notion's). A work item is named by its id in Plane here.
 */
export class PlaneTasks {
  constructor(
    protected config: () => Promise<PlaneConfig>,
    protected mirror: PlaneMirror,
    protected connect: (base: string, key: string) => PlaneApi = (base, key) => new PlaneClient(base, key)
  ) {}

  async #access(): Promise<Access | null> {
    const c = await this.config()
    const base = planeBase(c.url)
    const workspace = c.workspace.trim()
    return c.key && base && workspace ? { api: this.connect(base, c.key), base, workspace } : null
  }

  async #need(): Promise<Access> {
    const access = await this.#access()
    if (!access) throw new Error('Plane n’est pas configuré : l’adresse, le workspace et la clé d’API sont à renseigner')
    return access
  }

  // The instance, the workspace and the key are all there.
  async configured(): Promise<boolean> {
    return (await this.#access()) !== null
  }

  // The work item, its project, and the client to ask Plane about it.
  async #target(taskId: string) {
    const access = await this.#need()
    const task = await this.mirror.task(taskId)
    if (!task) throw new Error('Tâche Plane inconnue')
    return { ...access, project: task.project, workItem: task.id }
  }

  async sync(): Promise<void> {
    await this.syncCount()
  }

  /**
   * Reads the work items assigned to the user into the mirror: new and changed ones are written, a state change and
   * an edit by the user are kept as activity (Plane shows a work item's last change only, so what happened between
   * two syncs is dated by it), and the ones gone from the user's are hidden, not deleted. A change counts as the user's
   * only when Plane says they made it: one by someone else, or by a key the team shares, is not the user's time.
   */
  async syncCount(): Promise<{ tasks: number; edits: number; moves: number; who: string }> {
    const { api, base, workspace } = await this.#need()
    const me = await api.me()
    const c = await this.config()
    const projects = wantedProjects(await api.projects(workspace), c.projects)
    const members = new Map((await api.members(workspace)).map((m) => [m.id, m]))
    const before = new Map((await this.mirror.tasks()).map((t) => [t.id, t]))
    const columns: PlaneState[] = []
    const reads: { project: PlaneProject; item: PlaneWorkItem; state: PlaneState | undefined }[] = []
    // Read in full first: a failure half way leaves the mirror as it was.
    for (const project of projects) {
      const states = await api.states(workspace, project.id)
      columns.push(...states)
      const byId = new Map(states.map((s) => [s.id, s]))
      for (const item of await api.workItems(workspace, project.id)) {
        if (item.assignees.includes(me.id)) reads.push({ project, item, state: byId.get(item.state) })
      }
    }
    await this.mirror.replaceColumns(columnsOf(columns))
    const seen = new Set<string>()
    let edits = 0
    let moves = 0
    for (const { project, item, state } of reads) {
      const ref = refOf(project, item)
      const status = state?.name ?? ''
      await this.mirror.upsert({
        id: item.id,
        project: project.id,
        title: item.name,
        status,
        ref,
        url: webUrl({ base, workspace }, ref),
        lastEdited: item.updatedAt,
        due: item.targetDate?.slice(0, 10) ?? null,
        notionIds: notionIdsOf(item.descriptionHtml),
        people: peopleOf(item.assignees, members, me.id),
      })
      seen.add(item.id)
      const previous = before.get(item.id)
      if (!previous || previous.lastEdited === item.updatedAt || item.updatedBy !== me.id) continue
      if (previous.status && previous.status !== status) {
        await this.mirror.addStatusChange(item.updatedAt, item.id, previous.status, status)
        moves += 1
      } else {
        await this.mirror.addEdit(item.updatedAt, item.id, `« ${item.name} » modifiée dans Plane`)
        edits += 1
      }
    }
    await this.mirror.keepOnly(seen)
    return { tasks: seen.size, edits, moves, who: me.displayName || me.email || 'toi' }
  }

  // Moves the work item to the state of that name in its project, else to the first of the same group (each project
  // has its own states).
  async move(taskId: string, status: string): Promise<void> {
    const { api, workspace, project, workItem } = await this.#target(taskId)
    const columns = await this.mirror.columns()
    const group = columns.find((c) => c.name === status)?.group ?? null
    const state = pickState(await api.states(workspace, project), status, group)
    if (!state) throw new Error(`Le projet n'a pas d'état « ${status} »${group ? ' ni d’autre du même groupe' : ''}`)
    await api.setState(workspace, project, workItem, state.id)
    const was = (await this.mirror.task(taskId))?.status
    // Moved from the app: the next sync would find the state already mirrored.
    if (was && was !== state.name) await this.mirror.addStatusChange(new Date().toISOString(), taskId, was, state.name)
    await this.mirror.setStatus(taskId, state.name)
  }

  // The user's own work items only: Plane's search is not read, so another person's work item is not found here.
  async search(query: string): Promise<MirrorTask[]> {
    const needle = query.trim().toLowerCase()
    return (await this.mirror.tasks()).filter((t) => t.title.toLowerCase().includes(needle))
  }

  // Taking a work item on means being assigned to it, which only Plane's own interface does: one already in the
  // mirror is the user's, which is all `take` needs.
  async join(taskId: string): Promise<void> {
    if (await this.mirror.task(taskId)) return
    throw new Error('Une tâche Plane se prend dans Plane : elle apparaîtra ici une fois qu’elle te sera assignée')
  }

  // The work item's description, then its comments, as text.
  async page(taskId: string): Promise<TaskPage> {
    const { api, workspace, project, workItem } = await this.#target(taskId)
    const [item, comments] = await Promise.all([
      api.workItem(workspace, project, workItem),
      api.comments(workspace, project, workItem),
    ])
    return {
      text: htmlToText(item.descriptionHtml),
      comments: comments.map((c) => ({ at: c.createdAt, text: c.stripped?.trim() || htmlToText(c.html) })),
    }
  }

  async comment(taskId: string, text: string): Promise<void> {
    const { api, workspace, project, workItem } = await this.#target(taskId)
    await api.addComment(workspace, project, workItem, textToHtml(text))
  }
}

/**
 * The people assigned to a work item, named as the workspace names them. Plane has no responsible apart from those
 * taking part: everyone assigned is in charge of it, so each one is responsible (`owner`), the user included.
 */
export function peopleOf(assignees: string[], members: ReadonlyMap<string, PlaneMember>, me: string): TaskPerson[] {
  return assignees.flatMap((id) => {
    const m = members.get(id)
    if (!m) return []
    const name = m.displayName || [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email
    return name ? [{ name, email: m.email || null, avatar: null, role: 'owner' as const, me: id === me }] : []
  })
}
