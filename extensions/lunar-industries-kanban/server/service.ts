import type { ServerContext } from '@bidule/api/extensions'
import type { BranchRef, Branches, KanbanBranch } from '../contract.ts'
import { KanbanError } from './errors.ts'

export const DEFAULT_HIDDEN = 'main, master, develop, launchpad, factory, orbit'

// What the module reads and writes of the core's objects.
export type Objects = Pick<
  ServerContext['objects'],
  'providers' | 'list' | 'get' | 'relations' | 'related' | 'link' | 'unlink' | 'first'
>

// A branch with what the module needs besides what it shows: its object, its repository's, its last commit, and
// where its review (else its pipeline) is.
type Known = KanbanBranch & { id: string; repositoryId: string; headSha: string | null; url: string | null }

const keyOf = (b: BranchRef) => `${b.repo}\u0000${b.name}`

const shown = (b: Known): KanbanBranch => ({
  repo: b.repo,
  repoLabel: b.repoLabel,
  name: b.name,
  taskId: b.taskId,
  isDefault: b.isDefault,
  lastCommitAt: b.lastCommitAt,
  reviewNumber: b.reviewNumber,
  reviewRef: b.reviewRef,
  reviewState: b.reviewState,
  ci: b.ci,
})

/**
 * Taken from quack-board (Simon's board_controller, setBranches; forge links): the cards' branches, as the core has
 * them (branches and their repository, the `task → branch` links, the forges' reviews and pipelines). Without a
 * provider of branches, the board shows no branch at all.
 */
export class KanbanService {
  constructor(
    protected objects: Objects,
    // The names of the integration branches (the setting: comma-separated), which belong to no task either.
    protected hidden: () => Promise<string> = async () => DEFAULT_HIDDEN
  ) {}

  #has(type: 'branch' | 'review' | 'pipeline') {
    return this.objects.providers(type).length > 0
  }

  // Every branch, with its repository, its task (one the user linked by hand first) and its review and CI as git
  // gave them before: the latest review, the pipeline of its last commit, `merged` once the review is.
  async #all(): Promise<Known[]> {
    const [repos, branches, links, reviews, pipelines] = await Promise.all([
      this.objects.list('repository'),
      this.objects.list('branch'),
      this.objects.relations({ kind: 'branch', fromType: 'task', toType: 'branch' }),
      this.#has('review') ? this.objects.list('review') : [],
      this.#has('pipeline') ? this.objects.list('pipeline') : [],
    ])
    const repoOf = new Map(repos.map((r) => [r.id, r]))
    return branches.flatMap((b) => {
      const repo = repoOf.get(b.repositoryId)
      if (!repo) return []
      const linked = links.filter((l) => l.to.id === b.id)
      const task = linked.find((l) => l.origin === 'manual') ?? linked[0]
      const review = reviews.filter((r) => r.branchId === b.id).sort((x, y) => y.number - x.number)[0]
      const pipeline = pipelines.find((p) => p.branchId === b.id)
      return [
        {
          id: b.id,
          repositoryId: repo.id,
          repo: repo.path,
          repoLabel: repo.label,
          name: b.name,
          taskId: task?.from.id ?? null,
          isDefault: b.isDefault,
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
  }

  // Every branch but the repos' default ones (main…) and the integration ones (develop, factory…), which belong to no
  // task.
  async branches(): Promise<Branches> {
    if (!this.#has('branch')) return { available: false, branches: [] }
    const hidden = new Set(
      (await this.hidden())
        .split(',')
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean)
    )
    return {
      available: true,
      branches: (await this.#all()).filter((b) => !b.isDefault && !hidden.has(b.name.toLowerCase())).map(shown),
    }
  }

  /**
   * The task's branches are exactly these now: the others it had are unlinked, the new ones linked (taken from
   * another task if need be). An unknown branch changes nothing.
   */
  async setBranches(taskId: string, wanted: BranchRef[]): Promise<Branches> {
    if (!this.#has('branch')) throw new KanbanError('Aucun dépôt git : aucune extension ne fournit de branches', 409)
    const all = await this.#all()
    const byKey = new Map(all.map((b) => [keyOf(b), b]))
    const missing = wanted.find((b) => !byKey.has(keyOf(b)))
    if (missing) throw new KanbanError(`Branche inconnue : ${missing.name}`, 404)
    if (wanted.length && !(await this.objects.get('task', taskId))) throw new KanbanError('Tâche inconnue', 404)
    const keep = new Set(wanted.map(keyOf))
    for (const b of all.filter((b) => b.taskId === taskId && !keep.has(keyOf(b)))) await this.#link(b.id, null)
    for (const ref of wanted) {
      const b = byKey.get(keyOf(ref))
      if (b && b.taskId !== taskId) await this.#link(b.id, taskId)
    }
    return this.branches()
  }

  // A link by hand: its task, or `noTask`, first (the core's rule that links a branch by its task's reference then
  // leaves it alone; it runs again at each change, and would link the branch back meanwhile), then the branch's other
  // tasks and the opposite mark go.
  async #link(id: string, taskId: string | null) {
    const branch = { type: 'branch' as const, id }
    if (taskId) await this.objects.link({ type: 'task', id: taskId }, 'branch', branch, 'manual')
    else await this.objects.link(branch, 'noTask', branch, 'manual')
    for (const l of await this.objects.related(id, { kind: 'branch', type: 'task' }))
      if (!l.outgoing && l.id !== taskId) await this.objects.unlink({ type: 'task', id: l.id }, 'branch', branch)
    if (taskId) await this.objects.unlink(branch, 'noTask', branch)
  }

  // Where a mark of a card leads: the branch's review, else its pipeline, as the forges gave them; else asked of the
  // forge serving the repo now; null when neither is known.
  async reviewUrl(ref: BranchRef): Promise<string | null> {
    if (!this.#has('branch')) throw new KanbanError('Aucun dépôt git : aucune extension ne fournit de branches', 409)
    const branch = (await this.#all()).find((b) => keyOf(b) === keyOf(ref))
    if (!branch) return null
    if (branch.url) return branch.url
    const forge = await this.objects.first('review.forge', { repositoryId: branch.repositoryId })
    if (!forge) return null
    const review = await forge.review(branch.name)
    if (review) return review.url
    return branch.headSha ? ((await forge.pipeline(branch.headSha))?.url ?? null) : null
  }
}
