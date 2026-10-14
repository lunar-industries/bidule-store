import type { ServerContext } from '@bidule/api/extensions'
import type { StoredType } from '@bidule/sdk/objects'
import type { DayLog, Work, WorkBranch } from './days.ts'
import type { WorkEvent } from './engine.ts'

type Objects = ServerContext['objects']

// lunar-industries-common's link by hand (its command).
type LinkByHand = (args: { repo: string; name: string; taskId: string | null }) => Promise<{ linked: boolean }>

/**
 * The user's work, read from the core's objects as the official Temps reads it: the repositories and branches git
 * provides, the activity of git (with its repository and branch) and of the task providers (an edit, a change of
 * status, with its task), and the tasks the branches are linked to. A type nobody provides gives nothing.
 */
export function coreWork(objects: Objects, linkByHand: LinkByHand): Work {
  const has = (type: StoredType) => objects.providers(type).length > 0
  // The task of each branch, deleted ones included (a branch deleted since still says which task it was for).
  const taskOfBranch = async () =>
    new Map(
      (await objects.relations({ kind: 'branch', fromType: 'task', toType: 'branch' })).map((l) => [l.to.id, l.from.id])
    )

  return {
    async repos() {
      if (!has('repository')) return []
      return (await objects.list('repository')).map((r) => ({ path: r.path, label: r.label }))
    },

    // With the core's `noTask` mark of the branches the user unlinked by hand (a link from the branch to itself).
    async branches() {
      if (!has('branch') || !has('repository')) return []
      const [repos, branches, taskOf, marks] = await Promise.all([
        objects.list('repository', { withDeleted: true }),
        objects.list('branch'),
        taskOfBranch(),
        objects.relations({ kind: 'noTask', fromType: 'branch', toType: 'branch' }),
      ])
      const pathOf = new Map(repos.map((r) => [r.id, r.path]))
      const unlinked = new Set(marks.map((l) => l.from.id))
      return branches.flatMap((b): WorkBranch[] => {
        const repo = pathOf.get(b.repositoryId)
        if (!repo) return []
        return [{ repo, name: b.name, taskId: taskOf.get(b.id) ?? null, isDefault: b.isDefault, noTask: unlinked.has(b.id) }]
      })
    },

    async events(since, until) {
      if (!has('activity')) return []
      const gitThere = has('branch') && has('repository')
      const [activity, repos, branches, taskOf, toBranch, toRepo, toTask, columns] = await Promise.all([
        objects.list('activity', { between: { field: 'at', from: since, to: until } }),
        gitThere ? objects.list('repository', { withDeleted: true }) : [],
        gitThere ? objects.list('branch', { withDeleted: true }) : [],
        gitThere ? taskOfBranch() : new Map<string, string>(),
        gitThere ? objects.relations({ kind: 'branch', fromType: 'activity', toType: 'branch' }) : [],
        gitThere ? objects.relations({ kind: 'repository', fromType: 'activity', toType: 'repository' }) : [],
        has('task') ? objects.relations({ kind: 'task', fromType: 'activity', toType: 'task' }) : [],
        has('task') ? objects.columns() : [],
      ])
      const linked = (links: { from: { id: string }; to: { id: string } }[]) =>
        new Map(links.map((l) => [l.from.id, l.to.id]))
      const [branchOf, repoOf, taskOfActivity] = [linked(toBranch), linked(toRepo), linked(toTask)]
      const repoById = new Map(repos.map((r) => [r.id, r]))
      const branchById = new Map(branches.map((b) => [b.id, b]))
      // The groups of the statuses as they are now.
      const groups = new Map(columns.map((c) => [c.name, c.group]))
      return activity.flatMap((a): WorkEvent[] => {
        const branch = branchById.get(branchOf.get(a.id) ?? '')
        const repo = repoById.get(repoOf.get(a.id) ?? branch?.repositoryId ?? '')
        const task = taskOfActivity.get(a.id)
        if (repo && a.kind !== 'status')
          return [
            {
              at: a.at,
              kind: a.kind,
              repo: repo.path,
              branch: branch?.name ?? null,
              detail: a.detail ?? '',
              taskId: branch ? (taskOf.get(branch.id) ?? null) : null,
            },
          ]
        if (task && a.kind === 'edit')
          return [{ at: a.at, kind: 'task', repo: null, branch: null, detail: a.detail ?? 'Tâche modifiée', taskId: task }]
        if (task && a.kind === 'status')
          return [
            {
              at: a.at,
              kind: 'status',
              repo: null,
              branch: null,
              // The status it went to (the one it left is the provider's own).
              detail: `→ ${a.detail ?? ''}`,
              taskId: task,
              toGroup: groups.get(a.detail ?? '') ?? null,
            },
          ]
        return []
      })
    },

    // A link the user made (`manual`): the core's rule on branch names never undoes it. The branch's other tasks and
    // its « no task » mark go. A branch or task gone meanwhile is left as it is.
    async link(repo, name, taskId) {
      await linkByHand({ repo, name, taskId })
    },

    async tasks() {
      if (!has('task')) return new Map()
      return new Map((await objects.list('task')).map((t) => [t.id, { title: t.title, ref: t.ref, url: t.url }]))
    },
  }
}

/**
 * The Time Log, from the first extension providing time entries (Notion: its Time Log database): its name, whether
 * its settings are there, the user's entries of a period (`timeEntry.read`), what a line can carry
 * (`timeEntry.fields`) and a whole day written at once (`timeEntry.sendDay`), entries and tasks by the core's ids.
 * A provider without the last one: the day is prepared and not sent.
 */
export function coreTimeLog(objects: Objects): () => Promise<DayLog | null> {
  return async () => {
    const [provider] = objects.providers('timeEntry', 'timeEntry.status')
    if (!provider) return null
    const status = await objects.run('timeEntry.status', {}, provider)
    const log: DayLog = { name: status.name, configured: async () => status.configured }
    const offers = (action: 'timeEntry.read' | 'timeEntry.fields' | 'timeEntry.sendDay') =>
      objects.providers('timeEntry', action).includes(provider)
    if (offers('timeEntry.read')) log.read = (from, to) => objects.run('timeEntry.read', { from, to }, provider)
    if (offers('timeEntry.fields')) log.fields = () => objects.run('timeEntry.fields', {}, provider)
    if (offers('timeEntry.sendDay'))
      log.sendDay = (day, lines) => objects.run('timeEntry.sendDay', { day, lines }, provider)
    return log
  }
}
