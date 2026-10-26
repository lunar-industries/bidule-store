import type { ObjectsContext } from '@bidule/api/extensions'
import type { BranchFilter as CoreFilter, BranchState } from '@bidule/sdk/branches'
import type { BranchFilter, SharedBranch } from '../contract.ts'

// What the module reads and writes of the core's objects: the branches with their state, and their tasks.
export type Objects = Pick<ObjectsContext, 'providers' | 'list' | 'branches' | 'setTasks'>

// The core's filter for this one: a task's branches, else a repo's (one of them by its name), else all; null for a
// repo the core does not know.
async function coreFilter(objects: Objects, filter: BranchFilter): Promise<CoreFilter | null> {
  if (filter.taskId) return { taskId: filter.taskId }
  if (!filter.repo) return {}
  const [repo] = await objects.list('repository', { where: { path: filter.repo } })
  if (!repo) return null
  return filter.name ? { repositoryId: repo.id, name: filter.name } : { repositoryId: repo.id }
}

const shared = (b: BranchState, integration: Set<string>): SharedBranch => ({
  id: b.id,
  repositoryId: b.repositoryId,
  repo: b.repository.path,
  repoLabel: b.repository.label,
  name: b.name,
  isDefault: b.isDefault,
  integration: (b.integration && !b.isDefault) || integration.has(b.name.toLowerCase()),
  // Those linked by hand first.
  taskIds: [...b.tasks.filter((t) => t.origin === 'manual'), ...b.tasks.filter((t) => t.origin !== 'manual')].map((t) => t.id),
  taskId: (b.tasks.find((t) => t.origin === 'manual') ?? b.tasks[0])?.id ?? null,
  lastCommitAt: b.lastCommitAt,
  headSha: b.headSha,
  reviewNumber: b.review?.number ?? null,
  reviewRef: b.review?.label ?? null,
  reviewState: b.review?.state ?? null,
  ci: b.ci,
  url: b.review?.url ?? b.pipeline?.url ?? null,
})

/**
 * The branches as the core has them, with their state (`ctx.objects.branches`), newest first. `integration`: the
 * lower-cased names of the integration branches this module's setting adds to each repository's own.
 */
export async function sharedBranches(
  objects: Objects,
  integration: Set<string>,
  filter: BranchFilter
): Promise<{ available: boolean; branches: SharedBranch[] }> {
  if (!objects.providers('branch').length) return { available: false, branches: [] }
  const asked = await coreFilter(objects, filter)
  if (!asked) return { available: true, branches: [] }
  return { available: true, branches: (await objects.branches(asked)).map((b) => shared(b, integration)) }
}

// A branch of a repo (by its path) linked to a task by hand, or marked as having none (null).
export async function linkByHand(objects: Objects, repo: string, name: string, taskId: string | null): Promise<boolean> {
  return setTasksByHand(objects, repo, name, taskId ? [taskId] : [])
}

/**
 * A branch's tasks are exactly these now, linked by hand; none: marked as having none (the core's `setTasks`). False
 * when the core knows neither the branch nor one of the tasks.
 */
export async function setTasksByHand(objects: Objects, repo: string, name: string, taskIds: string[]): Promise<boolean> {
  const asked = await coreFilter(objects, { repo, name })
  const [found] = asked ? await objects.branches(asked) : []
  if (!found) return false
  try {
    await objects.setTasks(found.id, taskIds)
    return true
  } catch {
    return false
  }
}
