import type { ServerContext } from '@bidule/api/extensions'
import type { BranchFilter, SharedBranch } from '@bidule/ext-lunar-industries-common/contract'
import type { BranchRef, Branches, KanbanBranch } from '../contract.ts'
import { KanbanError } from './errors.ts'

// What the module reads of the core's objects itself: a task, and the forge serving a repo.
export type Objects = Pick<ServerContext['objects'], 'get' | 'first'>

// lunar-industries-common's commands: the branches as the core has them, and a link by hand.
export interface Shared {
  branches(filter: BranchFilter): Promise<{ available: boolean; branches: SharedBranch[] }>
  link(args: { repo: string; name: string; taskId: string | null }): Promise<{ linked: boolean }>
}

const NO_BRANCHES = 'Aucun dépôt git : aucune extension ne fournit de branches'

const keyOf = (b: BranchRef) => `${b.repo}\u0000${b.name}`

const shown = (b: SharedBranch): KanbanBranch => ({
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
 * them, read and linked through lunar-industries-common (their repository, task, review and CI). Without a provider
 * of branches, the board shows no branch at all.
 */
export class KanbanService {
  constructor(
    protected objects: Objects,
    protected shared: Shared
  ) {}

  // Every branch but the repos' default ones (main…) and the integration ones (develop…), which belong to no task.
  async branches(): Promise<Branches> {
    const { available, branches } = await this.shared.branches({})
    return { available, branches: branches.filter((b) => !b.isDefault && !b.integration).map(shown) }
  }

  /**
   * The task's branches are exactly these now: the others it had are unlinked, the new ones linked (taken from
   * another task if need be). An unknown branch changes nothing.
   */
  async setBranches(taskId: string, wanted: BranchRef[]): Promise<Branches> {
    const { available, branches: all } = await this.shared.branches({})
    if (!available) throw new KanbanError(NO_BRANCHES, 409)
    const byKey = new Map(all.map((b) => [keyOf(b), b]))
    const missing = wanted.find((b) => !byKey.has(keyOf(b)))
    if (missing) throw new KanbanError(`Branche inconnue : ${missing.name}`, 404)
    if (wanted.length && !(await this.objects.get('task', taskId))) throw new KanbanError('Tâche inconnue', 404)
    const keep = new Set(wanted.map(keyOf))
    for (const b of all.filter((b) => b.taskId === taskId && !keep.has(keyOf(b)))) await this.#link(b, null)
    for (const ref of wanted) {
      const b = byKey.get(keyOf(ref))
      if (b && b.taskId !== taskId) await this.#link(b, taskId)
    }
    return this.branches()
  }

  // A link by hand: its task, or none (`noTask`); the branch's other tasks go.
  async #link(b: SharedBranch, taskId: string | null) {
    const { linked } = await this.shared.link({ repo: b.repo, name: b.name, taskId })
    if (!linked) throw new KanbanError(`Branche ou tâche inconnue : ${b.name}`, 404)
  }

  // Where a mark of a card leads: the branch's review, else its pipeline, as the forges gave them; else asked of the
  // forge serving the repo now; null when neither is known.
  async reviewUrl(ref: BranchRef): Promise<string | null> {
    const { available, branches } = await this.shared.branches({ repo: ref.repo, name: ref.name })
    if (!available) throw new KanbanError(NO_BRANCHES, 409)
    const [branch] = branches
    if (!branch) return null
    if (branch.url) return branch.url
    const forge = await this.objects.first('review.forge', { repositoryId: branch.repositoryId })
    if (!forge) return null
    const review = await forge.review(branch.name)
    if (review) return review.url
    return branch.headSha ? ((await forge.pipeline(branch.headSha))?.url ?? null) : null
  }
}
