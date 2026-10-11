import type { ServerContext } from '@bidule/api/extensions'
import type { ForgeClient } from '@bidule/sdk/forges'
import type { Board, Task, TaskPage } from '@bidule/sdk/tasks'

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
