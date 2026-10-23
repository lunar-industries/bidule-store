import type { ObjectsContext } from '@bidule/api/extensions'
import type { StoredObject } from '@bidule/sdk/objects'
import type { BranchFilter, SharedBranch } from '../contract.ts'

// What the module reads and writes of the core's objects.
export type Objects = Pick<ObjectsContext, 'providers' | 'list' | 'get' | 'relations' | 'related' | 'link' | 'unlink'>

const has = (objects: Objects, type: 'branch' | 'review' | 'pipeline') => objects.providers(type).length > 0

// The branches a filter names: those a task links, else a repo's (one of them by its name), else all.
async function chosen(objects: Objects, filter: BranchFilter): Promise<StoredObject<'branch'>[]> {
  if (filter.taskId) {
    const ids = (await objects.related(filter.taskId, { kind: 'branch', type: 'branch' }))
      .filter((l) => l.outgoing)
      .map((l) => l.id)
    return ids.length ? objects.list('branch', { ids }) : []
  }
  if (filter.repo) {
    const [repo] = await objects.list('repository', { where: { path: filter.repo } })
    if (!repo) return []
    return objects.list('branch', { where: filter.name ? { repositoryId: repo.id, name: filter.name } : { repositoryId: repo.id } })
  }
  return objects.list('branch')
}

/**
 * The branches as the core has them, newest first: their repository, their task (the core's `task → branch` links,
 * the one made by hand first), their latest review and their CI (the forges' objects): `merged` once the review is,
 * else the pipeline of the last commit, `none` for a review without a pipeline, null when no forge read the branch.
 * `integration`: lower-cased names of the integration branches.
 */
export async function sharedBranches(
  objects: Objects,
  integration: Set<string>,
  filter: BranchFilter
): Promise<{ available: boolean; branches: SharedBranch[] }> {
  if (!has(objects, 'branch')) return { available: false, branches: [] }
  const branches = await chosen(objects, filter)
  if (!branches.length) return { available: true, branches: [] }
  const [repos, links, reviews, pipelines] = await Promise.all([
    objects.list('repository', { ids: [...new Set(branches.map((b) => b.repositoryId))] }),
    objects.relations({ kind: 'branch', fromType: 'task', toType: 'branch' }),
    has(objects, 'review') ? objects.list('review') : [],
    has(objects, 'pipeline') ? objects.list('pipeline') : [],
  ])
  const repoOf = new Map(repos.map((r) => [r.id, r]))
  const shared = branches.flatMap((b): SharedBranch[] => {
    const repo = repoOf.get(b.repositoryId)
    if (!repo) return []
    const linked = links.filter((l) => l.to.id === b.id)
    const taskIds = [...linked.filter((l) => l.origin === 'manual'), ...linked.filter((l) => l.origin !== 'manual')].map((l) => l.from.id)
    const review = reviews.filter((r) => r.branchId === b.id).sort((x, y) => y.number - x.number)[0]
    const pipeline = pipelines.find((p) => p.branchId === b.id)
    return [
      {
        id: b.id,
        repositoryId: repo.id,
        repo: repo.path,
        repoLabel: repo.label,
        name: b.name,
        isDefault: b.isDefault,
        integration: integration.has(b.name.toLowerCase()),
        taskId: taskIds[0] ?? null,
        taskIds,
        lastCommitAt: b.lastCommitAt,
        headSha: b.headSha,
        reviewNumber: review?.number ?? null,
        reviewRef: review?.label ?? null,
        reviewState: review?.state ?? null,
        ci: !review && !pipeline ? null : review?.state === 'merged' ? 'merged' : (pipeline?.status ?? 'none'),
        url: review?.url ?? pipeline?.url ?? null,
      },
    ]
  })
  return { available: true, branches: shared.sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? '')) }
}

/**
 * A branch of a repo (by its path) linked to a task by hand, in the core: the task's link (origin `manual`: the core's
 * rule on branch names no longer moves it), or the `noTask` mark when `taskId` is null; its other tasks and the
 * opposite mark go. False when the core knows neither the branch nor the task.
 */
export async function linkByHand(objects: Objects, repo: string, name: string, taskId: string | null): Promise<boolean> {
  return setTasksByHand(objects, repo, name, taskId ? [taskId] : [])
}

/**
 * A branch's tasks are exactly these now, all linked by hand (a task the rule linked is kept that way, since the core
 * drops a link by name once one is made by hand); none: the `noTask` mark. False when the core knows neither the
 * branch nor one of the tasks.
 */
export async function setTasksByHand(objects: Objects, repo: string, name: string, taskIds: string[]): Promise<boolean> {
  const [r] = await objects.list('repository', { where: { path: repo } })
  const [found] = r ? await objects.list('branch', { where: { repositoryId: r.id, name } }) : []
  if (!found) return false
  const wanted = [...new Set(taskIds)]
  for (const id of wanted) if (!(await objects.get('task', id))) return false
  const branch = { type: 'branch' as const, id: found.id }
  for (const id of wanted) await objects.link({ type: 'task', id }, 'branch', branch, 'manual')
  if (!wanted.length) await objects.link(branch, 'noTask', branch, 'manual')
  for (const l of await objects.related(found.id, { kind: 'branch', type: 'task' }))
    if (!l.outgoing && !wanted.includes(l.id)) await objects.unlink({ type: 'task', id: l.id }, 'branch', branch)
  if (wanted.length) await objects.unlink(branch, 'noTask', branch)
  return true
}
