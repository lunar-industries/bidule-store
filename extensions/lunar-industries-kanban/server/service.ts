import type { ServerContext } from '@bidule/api/extensions'
import type { BranchFilter, SharedBranch } from '@bidule/ext-lunar-industries-common/contract'
import type { BranchRef, Branches, KanbanBranch } from '../contract.ts'
import { KanbanError } from './errors.ts'

// What the module reads of the core's objects itself: a task.
export type Objects = Pick<ServerContext['objects'], 'get'>

// lunar-industries-common's commands: the branches as the core has them, and a branch's tasks set by hand.
export interface Shared {
  branches(filter: BranchFilter): Promise<{ available: boolean; branches: SharedBranch[] }>
  setTasks(args: { repo: string; name: string; taskIds: string[] }): Promise<{ linked: boolean }>
}

const NO_BRANCHES = 'Aucun dépôt git : aucune extension ne fournit de branches'

const keyOf = (b: BranchRef) => `${b.repo}\u0000${b.name}`

const shown = (b: SharedBranch): KanbanBranch => ({
  repo: b.repo,
  repoLabel: b.repoLabel,
  name: b.name,
  taskId: b.taskId,
  taskIds: b.taskIds,
  isDefault: b.isDefault,
  lastCommitAt: b.lastCommitAt,
  reviewNumber: b.reviewNumber,
  reviewRef: b.reviewRef,
  reviewState: b.reviewState,
  ci: b.ci,
  url: b.url,
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
   * The task's branches are exactly these now: the others it had leave it, the new ones are linked to it as well (a
   * branch can serve several tasks). An unknown branch changes nothing.
   */
  async setBranches(taskId: string, wanted: BranchRef[]): Promise<Branches> {
    const { available, branches: all } = await this.shared.branches({})
    if (!available) throw new KanbanError(NO_BRANCHES, 409)
    const byKey = new Map(all.map((b) => [keyOf(b), b]))
    const missing = wanted.find((b) => !byKey.has(keyOf(b)))
    if (missing) throw new KanbanError(`Branche inconnue : ${missing.name}`, 404)
    if (wanted.length && !(await this.objects.get('task', taskId))) throw new KanbanError('Tâche inconnue', 404)
    const keep = new Set(wanted.map(keyOf))
    for (const b of all.filter((b) => b.taskIds.includes(taskId) && !keep.has(keyOf(b))))
      await this.#setTasks(b, b.taskIds.filter((id) => id !== taskId))
    for (const ref of wanted) {
      const b = byKey.get(keyOf(ref))
      if (b && !b.taskIds.includes(taskId)) await this.#setTasks(b, [...b.taskIds, taskId])
    }
    return this.branches()
  }

  // The branch's tasks, by hand; none: marked so (`noTask`).
  async #setTasks(b: SharedBranch, taskIds: string[]) {
    const { linked } = await this.shared.setTasks({ repo: b.repo, name: b.name, taskIds })
    if (!linked) throw new KanbanError(`Branche ou tâche inconnue : ${b.name}`, 404)
  }

  // Where a mark of a card leads: the branch's review, else its pipeline, as the forges gave them (their sources'
  // addresses); null when neither is known.
  async reviewUrl(ref: BranchRef): Promise<string | null> {
    const { available, branches } = await this.shared.branches({ repo: ref.repo, name: ref.name })
    if (!available) throw new KanbanError(NO_BRANCHES, 409)
    return branches[0]?.url ?? null
  }
}
