import type { ObjectsContext } from '@bidule/api/extensions'
import type { GitSource } from '@bidule/ext-git/contract'
import type { ForgeClient } from '@bidule/sdk/forges'
import type { StoredObject } from '@bidule/sdk/objects'
import type { Job, ListedBranch, Links, ListedRepo, Listing } from '../contract.ts'
import { BranchesError } from './errors.ts'
import { issueOf, list, reviewDescription, templateOf } from './names.ts'

const K = 'lunar-industries-branches'

export interface BranchesDeps {
  // The core's objects the page reads: the repos and branches (git's), their tasks (links of the core), their reviews
  // and pipelines (the forges'), and the client on a repo's forge (`review.forge`).
  objects: Pick<ObjectsContext, 'list' | 'get' | 'relations' | 'first'>
  // What git does for the page: a branch's task set by hand, the repos read again.
  git: () => Pick<GitSource, 'link' | 'sync'>
  setting: (key: string) => Promise<unknown>
  save: (key: string, value: string) => Promise<void>
  // A repo's review target changed.
  changed: () => void
}

// A branch as the core has it, with what the listing adds left out.
type Branch = Omit<ListedBranch, 'forge' | 'issueNumber'> & { repositoryId: string }

// A forge's refusal (ForgeFailure: an Error with the HTTP status), as the page shows it.
function refused(err: unknown): BranchesError {
  if (err instanceof BranchesError) return err
  const status = typeof err === 'object' && err !== null ? Reflect.get(err, 'status') : undefined
  const message = err instanceof Error ? err.message : String(err)
  return new BranchesError(message, typeof status === 'number' && status >= 500 ? 502 : 422)
}

function targetsOf(text: unknown): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(String(text || '{}'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string' && Boolean(e[1])))
  } catch {
    return {}
  }
}

/**
 * Taken from quack-board (Simon's Branches page: board_controller, forge_controller, views.reviewTargets): the user's
 * branches with their repo's forge, and what can be done on the forge for one (review, pipeline, jobs), through the
 * client `review.forge` gives.
 */
export class BranchesService {
  constructor(protected deps: BranchesDeps) {}

  async #text(key: string) {
    return String((await this.deps.setting(`${K}.${key}`)) ?? '').trim()
  }

  async #template() {
    return templateOf((await this.#text('naming')) || 'issue', (await this.#text('template')) || '{ref}-{slug}')
  }

  async #targets() {
    return targetsOf(await this.deps.setting(`${K}.targets`))
  }

  // The branches of these repos, newest first: their task (the core's link), their latest review and their CI (the
  // forges' objects), as git put them together before.
  async #branches(repos: StoredObject<'repository'>[]): Promise<Branch[]> {
    const { objects } = this.deps
    const [branches, links, reviews, pipelines] = await Promise.all([
      objects.list('branch'),
      objects.relations({ kind: 'branch', fromType: 'task', toType: 'branch' }),
      objects.list('review'),
      objects.list('pipeline'),
    ])
    const byId = new Map(repos.map((r) => [r.id, r]))
    const tasks = new Map(links.map((l) => [l.to.id, l.from.id]))
    return branches
      .flatMap((b): Branch[] => {
        const repo = byId.get(b.repositoryId)
        if (!repo) return []
        const review = reviews.filter((r) => r.branchId === b.id).sort((x, y) => y.number - x.number)[0]
        const pipeline = pipelines.find((p) => p.branchId === b.id)
        return [
          {
            repositoryId: repo.id,
            repo: repo.path,
            repoLabel: repo.label,
            name: b.name,
            isDefault: b.isDefault,
            taskId: tasks.get(b.id) ?? null,
            lastCommitAt: b.lastCommitAt,
            headSha: b.headSha,
            reviewNumber: review?.number ?? null,
            reviewState: review?.state ?? null,
            ci: review?.state === 'merged' ? 'merged' : review || pipeline ? (pipeline?.status ?? 'none') : null,
          },
        ]
      })
      .sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''))
  }

  async #repo(path: string): Promise<StoredObject<'repository'>> {
    const [repo] = await this.deps.objects.list('repository', { where: { path } })
    if (!repo) throw new BranchesError('Dépôt inconnu', 404)
    return repo
  }

  // The client on a repo's project, from the forge serving it: null without one, or without its token.
  #forgeOf(repositoryId: string): Promise<ForgeClient | null> {
    return this.deps.objects.first('review.forge', { repositoryId })
  }

  // The branches of the user's repos (newest first), without the default and integration ones, and the repos with
  // where their reviews can go.
  async list(): Promise<Listing> {
    const repos = await this.deps.objects.list('repository')
    const all = await this.#branches(repos)
    const hidden = new Set(list(await this.#text('hidden')).map((n) => n.toLowerCase()))
    const template = await this.#template()
    const own = await this.#targets()
    const forges = new Map(
      await Promise.all(repos.map(async (r) => [r.id, (await this.#forgeOf(r.id).catch(() => null))?.kind ?? null] as const))
    )
    const targets = new Map<string, string[]>()
    for (const b of all) {
      if (!b.isDefault && !hidden.has(b.name.toLowerCase())) continue
      const names = targets.get(b.repo) ?? []
      targets.set(b.repo, b.isDefault ? [b.name, ...names.filter((n) => n !== b.name)] : names.includes(b.name) ? names : [...names, b.name])
    }
    const listed: ListedRepo[] = repos
      .map((r) => ({
        path: r.path,
        label: r.label,
        forge: forges.get(r.id) ?? null,
        targets: targets.get(r.path) ?? [],
        reviewTarget: own[r.path] ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
    return {
      branches: all
        .filter((b) => !b.isDefault && !hidden.has(b.name.toLowerCase()))
        .map((b) => {
          const { repositoryId, ...shown } = b
          return { ...shown, forge: forges.get(repositoryId) ?? null, issueNumber: issueOf(template, b.name) }
        }),
      repos: listed,
      defaultTarget: (await this.#text('reviewTarget')) || null,
    }
  }

  async #branch(repo: string, name: string): Promise<{ b: Branch; client: ForgeClient }> {
    const r = await this.#repo(repo).catch(() => null)
    const b = r ? (await this.#branches([r])).find((x) => x.name === name) : undefined
    if (!b) throw new BranchesError('Branche inconnue', 404)
    const client = await this.#forgeOf(b.repositoryId)
    if (!client) throw new BranchesError(`${b.repoLabel} n'a pas de remote GitHub ou GitLab, ou pas de jeton pour sa forge`)
    return { b, client }
  }

  // A write on the forge, then git read again (its review and CI follow), before the answer: the page reloads from it, and
  // would show the state before the write otherwise. A read that fails does not undo the write.
  async #act<T>(work: () => Promise<T>): Promise<T> {
    let done: T
    try {
      done = await work()
    } catch (err) {
      throw refused(err)
    }
    await this.deps.git().sync().catch(() => undefined)
    return done
  }

  // Through git, which keeps the link in the core (by hand: the name's reference no longer moves it).
  async link(repo: string, name: string, taskId: string | null): Promise<void> {
    if (!(await this.deps.git().link(repo, name, taskId))) throw new BranchesError('Branche inconnue', 404)
  }

  // Where its review, its latest pipeline and its issue are: read on the forge now, for the branch shown.
  async links(repo: string, name: string): Promise<Links> {
    const { b, client } = await this.#branch(repo, name)
    const issueNumber = issueOf(await this.#template(), name)
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
    const { client } = await this.#branch(repo, name)
    await this.#act(() => client.runPipeline(name))
  }

  async retry(repo: string, name: string): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    await this.#act(async () => {
      const pipeline = b.headSha ? await client.pipeline(b.headSha) : null
      if (!pipeline) throw new BranchesError(`${name} n'a pas de pipeline à relancer`)
      await client.retryPipeline(pipeline.id)
    })
  }

  async play(repo: string, name: string, jobId: number): Promise<void> {
    const { client } = await this.#branch(repo, name)
    await this.#act(() => client.playJob(jobId))
  }

  // A draft review towards the target asked, else the repo's, else the settings'; titled after the branch's task.
  async review(repo: string, name: string, target: string | null): Promise<void> {
    const { b, client } = await this.#branch(repo, name)
    const into = target || (await this.#targets())[repo] || (await this.#text('reviewTarget')) || null
    if (!into) throw new BranchesError('Choisis la branche cible de la MR')
    const task = b.taskId ? await this.deps.objects.get('task', b.taskId).catch(() => null) : null
    await this.#act(async () => {
      // A number in the name is no proof of an issue (2024-cleanup): « Closes # » would close one the branch has nothing
      // to do with, so it stays only when the forge has that issue.
      const guess = issueOf(await this.#template(), name)
      const issueNumber = guess !== null && (await client.issue(guess)) ? guess : null
      const description = reviewDescription(issueNumber, task?.url ?? null)
      await client.createReview({ source: name, target: into, title: task?.title ?? name, description, draft: true })
    })
  }

  // Where the repo's reviews go by default; null to fall back on the settings'.
  async setTarget(repo: string, target: string | null): Promise<void> {
    await this.#repo(repo)
    const own = await this.#targets()
    if (target) own[repo] = target
    else delete own[repo]
    await this.deps.save(`${K}.targets`, JSON.stringify(own))
    this.deps.changed()
  }
}
