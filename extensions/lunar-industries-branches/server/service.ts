import type { ObjectsContext } from '@bidule/api/extensions'
import type { BranchFilter, SharedBranch, SharedSettings } from '@bidule/ext-lunar-industries-common/contract'
import type { ForgeClient } from '@bidule/sdk/forges'
import type { Job, ListedBranch, Links, ListedRepo, Listing } from '../contract.ts'
import { BranchesError } from './errors.ts'
import { issueOf, reviewDescription } from './names.ts'

// lunar-industries-common's commands: the branches as the core has them, a link by hand, the shared settings (the
// integration branches, the review targets, the naming of the branches) and a repo's own target.
export interface Shared {
  branches(filter: BranchFilter): Promise<{ available: boolean; branches: SharedBranch[] }>
  link(args: { repo: string; name: string; taskId: string | null }): Promise<{ linked: boolean }>
  settings(): Promise<SharedSettings>
  setTarget(args: { repo: string; target: string | null }): Promise<void>
}

export interface BranchesDeps {
  // The core's objects the page reads itself: the repos (git's), the branches (pushed or not) and their reviews (a
  // draft or not), a branch's task, the client on a repo's forge (`review.forge`), and that forge reading a branch
  // again after a write there (`review.refresh`).
  objects: Pick<ObjectsContext, 'list' | 'get' | 'first'>
  shared: Shared
  // git's push of a branch to origin (its action `git.push`): how it went, in git's words.
  git: { push(repo: string, branch: string): Promise<{ ok: boolean; message: string }> }
}

// A forge's refusal (ForgeFailure: an Error with the HTTP status), as the page shows it.
function refused(err: unknown): BranchesError {
  if (err instanceof BranchesError) return err
  const status = typeof err === 'object' && err !== null ? Reflect.get(err, 'status') : undefined
  const message = err instanceof Error ? err.message : String(err)
  return new BranchesError(message, typeof status === 'number' && status >= 500 ? 502 : 422)
}

// Neither a repo's default branch nor an integration one: a branch that belongs to a task.
const ofTask = (b: SharedBranch) => !b.isDefault && !b.integration

/**
 * Taken from quack-board (Simon's Branches page: board_controller, forge_controller, views.reviewTargets): the user's
 * branches with their repo's forge, and what can be done on the forge for one (review, pipeline, jobs), through the
 * client `review.forge` gives. The branches, their task and the settings are lunar-industries-common's.
 */
export class BranchesService {
  constructor(protected deps: BranchesDeps) {}

  // The client on a repo's project, from the forge serving it: null without one, or without its token.
  #forgeOf(repositoryId: string): Promise<ForgeClient | null> {
    return this.deps.objects.first('review.forge', { repositoryId })
  }

  // The branches of the user's repos (newest first), without the default and integration ones, and the repos with
  // where their reviews can go (their default branch, then their integration ones).
  async list(): Promise<Listing> {
    const { objects, shared } = this.deps
    const [repos, { branches: all }, s] = await Promise.all([objects.list('repository'), shared.branches({}), shared.settings()])
    // What lunar-industries-common does not say: pushed or not (git's), its review a draft or not (the forge's).
    const [cores, reviews] = await Promise.all([
      all.length ? objects.list('branch', { ids: all.map((b) => b.id) }) : [],
      objects.list('review').catch(() => []),
    ])
    const core = new Map(cores.map((b) => [b.id, b]))
    const draft = new Map<string, { number: number; draft: boolean }>()
    for (const r of reviews) {
      const seen = draft.get(r.branchId)
      if (!seen || r.number > seen.number) draft.set(r.branchId, r)
    }
    const forges = new Map(
      await Promise.all(repos.map(async (r) => [r.id, (await this.#forgeOf(r.id).catch(() => null))?.kind ?? null] as const))
    )
    const targets = new Map<string, string[]>()
    for (const b of all.filter((b) => !ofTask(b))) {
      const names = targets.get(b.repo) ?? []
      targets.set(b.repo, b.isDefault ? [b.name, ...names.filter((n) => n !== b.name)] : names.includes(b.name) ? names : [...names, b.name])
    }
    const listed: ListedRepo[] = repos
      .map((r) => ({
        path: r.path,
        label: r.label,
        forge: forges.get(r.id) ?? null,
        targets: targets.get(r.path) ?? [],
        reviewTarget: s.targets[r.path] ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
    return {
      branches: all.filter(ofTask).map(
        (b): ListedBranch => ({
          repo: b.repo,
          repoLabel: b.repoLabel,
          name: b.name,
          isDefault: b.isDefault,
          taskId: b.taskId,
          lastCommitAt: b.lastCommitAt,
          headSha: b.headSha,
          reviewNumber: b.reviewNumber,
          reviewState: b.reviewState,
          reviewDraft: b.reviewNumber === null ? null : (draft.get(b.id)?.draft ?? null),
          ci: b.ci,
          pushed: core.get(b.id)?.pushed ?? false,
          ahead: core.get(b.id)?.ahead ?? 0,
          forge: forges.get(b.repositoryId) ?? null,
          issueNumber: issueOf(s.template, b.name),
        })
      ),
      repos: listed,
      defaultTarget: s.reviewTarget,
    }
  }

  async #branch(repo: string, name: string): Promise<{ b: SharedBranch; client: ForgeClient }> {
    const [b] = (await this.deps.shared.branches({ repo, name })).branches
    if (!b) throw new BranchesError('Branche inconnue', 404)
    const client = await this.#forgeOf(b.repositoryId)
    if (!client) throw new BranchesError(`${b.repoLabel} n'a pas de remote GitHub ou GitLab, ou pas de jeton pour sa forge`)
    return { b, client }
  }

  // A write on the forge, then the forge reads the branch again (`review.refresh`: its review and CI follow), before the
  // answer: the page reloads from it, and would show the state before the write otherwise. A read that fails does not
  // undo the write.
  async #act<T>(b: SharedBranch, work: () => Promise<T>): Promise<T> {
    let done: T
    try {
      done = await work()
    } catch (err) {
      throw refused(err)
    }
    await this.deps.objects.first('review.refresh', { repositoryId: b.repositoryId, branchIds: [b.id] }).catch(() => null)
    return done
  }

  // A branch linked to a task by hand (null: unlinked), in the core: lunar-industries-common's link.
  async link(repo: string, name: string, taskId: string | null): Promise<void> {
    const { linked } = await this.deps.shared.link({ repo, name, taskId })
    if (!linked) throw new BranchesError('Branche ou tâche inconnue', 404)
  }

  // Where its review, its latest pipeline and its issue are: read on the forge now, for the branch shown.
  async links(repo: string, name: string): Promise<Links> {
    const { b, client } = await this.#branch(repo, name)
    const issueNumber = issueOf((await this.deps.shared.settings()).template, name)
    try {
      const [review, pipeline, issue] = await Promise.all([
        client.review(name),
        b.headSha ? client.pipeline(b.headSha) : null,
        issueNumber ? client.issue(issueNumber) : null,
      ])
      return { reviewUrl: review?.url ?? null, pipelineUrl: pipeline?.url ?? null, issueUrl: issue?.url ?? null }
    } catch (err) {
      throw refused(err)
    }
  }

  async jobs(repo: string, name: string): Promise<Job[]> {
    const { b, client } = await this.#branch(repo, name)
    try {
      const pipeline = b.headSha ? await client.pipeline(b.headSha) : null
      return pipeline ? await client.jobs(pipeline.id) : []
    } catch (err) {
      throw refused(err)
    }
  }

  async runPipeline(repo: string, name: string): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    await this.#act(b, () => client.runPipeline(name))
  }

  async retry(repo: string, name: string): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    await this.#act(b, async () => {
      const pipeline = b.headSha ? await client.pipeline(b.headSha) : null
      if (!pipeline) throw new BranchesError(`${name} n'a pas de pipeline à relancer`)
      await client.retryPipeline(pipeline.id)
    })
  }

  async play(repo: string, name: string, jobId: number): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    await this.#act(b, () => client.playJob(jobId))
  }

  // A draft review towards the target asked, else the repo's, else the shared one; titled after the branch's task.
  async review(repo: string, name: string, target: string | null): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    const s = await this.deps.shared.settings()
    const into = target || s.targets[repo] || s.reviewTarget
    if (!into) throw new BranchesError(`Choisis la branche cible de la ${client.kind === 'github' ? 'PR' : 'MR'}`)
    const task = b.taskId ? await this.deps.objects.get('task', b.taskId).catch(() => null) : null
    await this.#act(b, async () => {
      // A number in the name is no proof of an issue (2024-cleanup): « Closes # » would close one the branch has nothing
      // to do with, so it stays only when the forge has that issue.
      const guess = issueOf(s.template, name)
      const issueNumber = guess !== null && (await client.issue(guess)) ? guess : null
      const description = reviewDescription(issueNumber, task?.url ?? null)
      await client.createReview({ source: name, target: into, title: task?.title ?? name, description, draft: true })
    })
  }

  // The branch's latest review on the forge, which a write about it needs: none is said.
  async #review(client: ForgeClient, name: string) {
    const review = await client.review(name).catch((err: unknown) => Promise.reject(refused(err)))
    if (!review || review.state !== 'open') throw new BranchesError(`${name} n'a pas de revue ouverte`)
    return review
  }

  // Its review out of draft: ready to be read (nothing to do when it already is).
  async ready(repo: string, name: string): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    const review = await this.#review(client, name)
    if (!review.draft) return
    await this.#act(b, () => client.markReady(review.number))
  }

  // Its review merged on the forge, as its button there does; a draft is refused (neither forge merges one).
  async merge(repo: string, name: string): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    const review = await this.#review(client, name)
    if (review.draft) throw new BranchesError("La revue est encore en brouillon : sors-la du brouillon d'abord")
    await this.#act(b, () => client.mergeReview(review.number))
  }

  // The branch to origin through git (never forced, its upstream set the first time); a push origin refuses says git's
  // words. git announces the change, and the forges read the branch again from it.
  async push(repo: string, name: string): Promise<void> {
    const [b] = (await this.deps.shared.branches({ repo, name })).branches
    if (!b) throw new BranchesError('Branche inconnue', 404)
    const done = await this.deps.git.push(repo, name)
    if (!done.ok) throw new BranchesError(done.message || `${name} n'a pas pu être poussée`)
  }

  // Where the repo's reviews go by default; null to fall back on the shared target. lunar-industries-common refuses a
  // repo the core does not know (404) and tells the change (`lunar-industries-common.changed`).
  async setTarget(repo: string, target: string | null): Promise<void> {
    await this.deps.shared.setTarget({ repo, target })
  }
}
