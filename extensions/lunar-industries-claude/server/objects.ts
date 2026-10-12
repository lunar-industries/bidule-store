import type { ObjectsContext, ServerContext } from '@bidule/api/extensions'
import type { ForgeClient } from '@bidule/sdk/forges'
import type { Ci, StoredObject } from '@bidule/sdk/objects'
import type { Board, Task, TaskPage } from '@bidule/sdk/tasks'

/**
 * The branches as the sessions and their tools read them: the core's objects (git's branches and repos), their task
 * (the core's links `task → branch`, which the rule on the task's reference and the user keep), their latest review
 * and CI (the forges' objects). git's own actions (its CLI, worktrees, the repos' state) stay git's.
 */
export interface BranchAccess {
  // A task's branches, by their repo's label: the repo by its path (git's actions take it), how the forge cites the
  // latest review (« MR !12 ») and the CI (merged once the review is); null when no forge read it.
  ofTask(taskId: string): Promise<{ repo: string; repoLabel: string; name: string; review: string | null; ci: Ci | null }[]>
  // The task a branch of a repo (by its path) is linked to, by hand first; null when none, or unknown.
  taskOf(repo: string, name: string): Promise<string | null>
  /**
   * Links a branch to a task by hand, in the core: the task's link (origin `manual`: the name's reference no longer
   * moves it); its other tasks and its `noTask` mark go. False when the core does not know the branch.
   */
  link(repo: string, name: string, taskId: string): Promise<boolean>
}

export type BranchObjects = Pick<ObjectsContext, 'list' | 'related' | 'relations' | 'link' | 'unlink'>

export function branchAccess(objects: BranchObjects): BranchAccess {
  // A branch of a repo, by the repo's path and its name.
  const find = async (path: string, name: string): Promise<StoredObject<'branch'> | null> => {
    const [repo] = await objects.list('repository', { where: { path } })
    const [branch] = repo ? await objects.list('branch', { where: { repositoryId: repo.id, name } }) : []
    return branch ?? null
  }
  return {
    async ofTask(taskId) {
      const ids = (await objects.related(taskId, { kind: 'branch', type: 'branch' }))
        .filter((l) => l.outgoing)
        .map((l) => l.id)
      if (!ids.length) return []
      const branches = await objects.list('branch', { ids })
      const [repos, reviews, pipelines] = await Promise.all([
        objects.list('repository', { ids: [...new Set(branches.map((b) => b.repositoryId))] }),
        objects.list('review'),
        objects.list('pipeline'),
      ])
      const byId = new Map(repos.map((r) => [r.id, r]))
      return branches
        .flatMap((b) => {
          const repo = byId.get(b.repositoryId)
          if (!repo) return []
          const review = reviews.filter((r) => r.branchId === b.id).sort((x, y) => y.number - x.number)[0]
          const pipeline = pipelines.find((p) => p.branchId === b.id)
          const ci: Ci | null = review?.state === 'merged' ? 'merged' : review || pipeline ? (pipeline?.status ?? 'none') : null
          return [{ repo: repo.path, repoLabel: repo.label, name: b.name, review: review?.label ?? null, ci }]
        })
        .sort((a, b) => a.repoLabel.localeCompare(b.repoLabel))
    },
    async taskOf(path, name) {
      const branch = await find(path, name)
      if (!branch) return null
      const links = (await objects.related(branch.id, { kind: 'branch', type: 'task' })).filter((l) => !l.outgoing)
      return (links.find((l) => l.origin === 'manual') ?? links[0])?.id ?? null
    },
    async link(path, name, taskId) {
      const found = await find(path, name)
      if (!found) return false
      const branch = { type: 'branch' as const, id: found.id }
      await objects.link({ type: 'task', id: taskId }, 'branch', branch, 'manual')
      for (const l of await objects.related(found.id, { kind: 'branch', type: 'task' }))
        if (!l.outgoing && l.id !== taskId) await objects.unlink({ type: 'task', id: l.id }, 'branch', branch)
      await objects.unlink(branch, 'noTask', branch)
      return true
    },
  }
}

/**
 * The tasks as the sessions and their tools read and write them: the core's objects (type `task`, whichever
 * extensions provide them), their columns, and the base actions sent to each task's provider.
 */
export interface TaskAccess {
  // The user's board: the providers' columns, and the tasks the user is on.
  board(): Promise<Board>
  // Any task the core knows, on the board or not (done, someone else's); null when unknown.
  get(id: string): Promise<Task | null>
  // A task by its id or its reference (ID-101, in any case): the user's own first, then any the core knows.
  find(key: string): Promise<Task | null>
  // Tasks found in the tools themselves (task.search, by title), as the core keeps them.
  search(q: string): Promise<Task[]>
  move(taskId: string, status: string): Promise<void>
  // Its page's text and comments (empty when its provider does not tell).
  page(taskId: string): Promise<TaskPage>
  comment(taskId: string, text: string): Promise<void>
}

const EMPTY_PAGE: TaskPage = { text: '', comments: [] }

// null without any provider of tasks.
export function taskAccess(ctx: ServerContext): TaskAccess | null {
  const { objects } = ctx
  if (!objects.providers('task').length) return null
  const get = (id: string) => objects.get('task', id)
  // Whether the task's provider answers this base action.
  const answers = (task: Task, action: 'task.page' | 'task.comment') => objects.providers('task', action).includes(task.provider)
  return {
    board: async () => {
      const [columns, tasks] = await Promise.all([objects.columns(), objects.list('task')])
      const seen = new Set<string>()
      return {
        source: objects.providers('task').join(', '),
        configured: columns.length > 0,
        // A status two tools share is one column, as on the Kanban.
        columns: columns.flatMap(({ name, color, group }) => {
          if (seen.has(name)) return []
          seen.add(name)
          return [{ name, color, group }]
        }),
        tasks: tasks.filter((t) => t.role !== null),
      }
    },
    get,
    find: async (key) => {
      const wanted = key.trim()
      const byId = wanted ? await get(wanted) : null
      if (byId) return byId
      const ref = wanted.toLowerCase()
      const found = (await objects.list('task')).filter((t) => t.ref?.toLowerCase() === ref)
      return found.find((t) => t.role !== null) ?? found[0] ?? null
    },
    search: async (q) => {
      const found = await Promise.all(
        objects.providers('task', 'task.search').map((p) => objects.run('task.search', { q }, p).catch((): string[] => []))
      )
      const ids = found.flat()
      return ids.length ? objects.list('task', { ids }) : []
    },
    move: (taskId, status) => objects.act('task.move', taskId, { status }),
    page: async (taskId) => {
      const task = await get(taskId)
      return task && answers(task, 'task.page') ? objects.act('task.page', taskId, {}) : EMPTY_PAGE
    },
    comment: async (taskId, text) => {
      const task = await get(taskId)
      if (!task || !answers(task, 'task.comment')) throw new Error('La source de tâches ne prend pas de commentaires')
      await objects.act('task.comment', taskId, { text })
    },
  }
}

// The forge serving a repo (by its path), as a client on its project (`review.forge`): null without one, or without
// its token.
export async function forgeOf(ctx: ServerContext, path: string): Promise<ForgeClient | null> {
  const [repo] = await ctx.objects.list('repository', { where: { path } })
  return repo ? ctx.objects.first('review.forge', { repositoryId: repo.id }) : null
}

// After a write on the forge: the forge serving the repo (by its path) reads the branch's review and pipeline again
// (`review.refresh`), so that the Kanban's and Branches' badges follow at once. Never fails: the next read tells it.
export async function refreshForge(ctx: ServerContext, path: string, branch: string): Promise<void> {
  try {
    const [repo] = await ctx.objects.list('repository', { where: { path } })
    if (!repo) return
    const branches = await ctx.objects.list('branch', { where: { repositoryId: repo.id, name: branch } })
    await ctx.objects.first('review.refresh', { repositoryId: repo.id, branchIds: branches.map((b) => b.id) })
  } catch {
    // Read again in the forge's next run.
  }
}
