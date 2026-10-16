import type { SharedBranch, SharedSettings } from '@bidule/ext-lunar-industries-common/contract'
import type { ForgeClient, ForgeJob, NewReview } from '@bidule/sdk/forges'
import type { StoredObject, StoredType } from '@bidule/sdk/objects'
import type { Task } from '@bidule/sdk/tasks'
import type { ListedBranch } from '../contract.ts'
import { BranchesService, type BranchesDeps, type Shared } from '../server/service.ts'

// A branch as a test describes it: what the core has of it, its task link, review and CI included.
export type Spec = Omit<ListedBranch, 'forge' | 'issueNumber'>

// One time for every branch of a test: recent, and the same, so the listing keeps the order they are given in.
const NOW = new Date().toISOString()

export function branch(fields: Partial<Spec> & { name: string }): Spec {
  return {
    repo: '/r/app',
    repoLabel: 'app',
    taskId: null,
    isDefault: false,
    lastCommitAt: NOW,
    headSha: 'abc',
    reviewNumber: null,
    reviewState: null,
    reviewDraft: null,
    ci: null,
    pushed: true,
    ahead: 1,
    ...fields,
  }
}

export const listed = (fields: Partial<ListedBranch> & { name: string }): ListedBranch => ({
  forge: 'gitlab',
  issueNumber: null,
  ...branch(fields),
  ...fields,
})

export function task(id: string, title: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    type: 'task',
    provider: 'notion',
    ref: null,
    url: `https://notion.so/${id}`,
    properties: {},
    title,
    status: 'En cours',
    group: 'doing',
    role: 'owner',
    lastEdited: null,
    due: null,
    ...fields,
  }
}

// A forge that records what it is asked to do.
export function fakeForge(fields: Partial<ForgeClient> = {}) {
  const calls: string[] = []
  const reviews: NewReview[] = []
  const jobs: ForgeJob[] = [
    { id: 7, name: 'deploy', stage: 'deploy', status: 'manual', manual: true },
    { id: 8, name: 'test', stage: 'test', status: 'success', manual: false },
  ]
  const client: ForgeClient = {
    kind: 'gitlab',
    name: 'GitLab',
    project: 'team/app',
    review: async () => ({ number: 12, state: 'open', draft: true, url: 'https://gitlab.com/team/app/-/merge_requests/12', description: '' }),
    pipeline: async (sha) => (sha ? { id: 99, status: 'fail', url: 'https://gitlab.com/team/app/-/pipelines/99' } : null),
    jobs: async (id) => (calls.push(`jobs ${id}`), jobs),
    issue: async (n) => ({ number: n, state: 'open', url: `https://gitlab.com/team/app/-/issues/${n}`, description: '' }),
    runPipeline: async (b) => void calls.push(`run ${b}`),
    retryPipeline: async (id) => void calls.push(`retry ${id}`),
    playJob: async (id) => void calls.push(`play ${id}`),
    createReview: async (r) => {
      reviews.push(r)
      return { number: 13, state: 'open', draft: true, url: 'u', description: r.description }
    },
    markReady: async () => undefined,
    mergeReview: async () => undefined,
    createIssue: async () => ({ number: 1, state: 'open', url: 'u', description: '' }),
    createBranch: async () => undefined,
    ...fields,
  }
  return { client, calls, reviews }
}

const repoId = (path: string) => `repo:${path}`
const branchId =(b: { repo: string; name: string }) => `${b.repo}\n${b.name}`

// These branches as the core has them; the forge `review.forge` gives (null: none), and what `review.refresh` was asked.
export function fakeWorld(branches: Spec[], forge: ForgeClient | null) {
  // What the forge was asked to read again (`review.refresh`).
  const refreshed: unknown[] = []
  return { world: { branches, forge, refreshed }, refreshed }
}

type World = ReturnType<typeof fakeWorld>['world']

// The shared settings as a new install has them.
const SETTINGS: SharedSettings = { integrationBranches: [], reviewTarget: null, targets: {}, naming: 'issue', template: '{issue}-{slug}' }

// lunar-industries-common for these branches (its join of the core's objects and its link are tested there): the
// branches, a link by hand (each said: `name→task`), the shared settings and a repo's own target.
function sharedOf({ branches }: World, tasks: Task[], settings: SharedSettings, links: string[]): Shared {
  const integration = new Set(settings.integrationBranches.map((n) => n.toLowerCase()))
  const shared = (b: Spec): SharedBranch => ({
    ...b,
    id: branchId(b),
    repositoryId: repoId(b.repo),
    integration: integration.has(b.name.toLowerCase()),
    reviewRef: b.reviewNumber ? `MR !${b.reviewNumber}` : null,
    url: null,
  })
  return {
    branches: async ({ repo, name }) => ({
      available: true,
      branches: branches
        .filter((b) => (!repo || b.repo === repo) && (!name || b.name === name))
        .map(shared)
        .sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? '')),
    }),
    link: async ({ repo, name, taskId }) => {
      const b = branches.find((x) => x.repo === repo && x.name === name)
      if (!b || (taskId && !tasks.some((t) => t.id === taskId))) return { linked: false }
      b.taskId = taskId
      links.push(`${name}→${taskId}`)
      return { linked: true }
    },
    settings: async () => settings,
    setTarget: async ({ repo, target }) => {
      if (!branches.some((b) => b.repo === repo)) throw Object.assign(new Error('Dépôt inconnu'), { status: 404 })
      const own = { ...settings.targets }
      if (target) own[repo] = target
      else delete own[repo]
      settings.targets = own
    },
  }
}

// The core's objects the page reads itself: the repos, the tasks, the forge.
function objectsOf({ branches, forge, refreshed }: World, tasks: Task[]): BranchesDeps['objects'] {
  const base = { provider: 'git', ref: null, url: null, properties: {} }
  const repository: StoredObject<'repository'>[] = [...new Set(branches.map((b) => b.repo))].map((path) => ({
    ...base,
    id: repoId(path),
    type: 'repository',
    path,
    label: branches.find((b) => b.repo === path)?.repoLabel ?? path,
    remoteHost: 'gitlab.com',
    remotePath: 'team/app',
    defaultBranch: branches.find((b) => b.repo === path && b.isDefault)?.name ?? null,
  }))
  // git's side of each branch (pushed, commits ahead), and the forges' reviews (a draft or not).
  const branch = branches.map((b) => ({ id: branchId(b), pushed: b.pushed, ahead: b.ahead }))
  const review = branches.flatMap((b) =>
    b.reviewNumber === null ? [] : [{ id: `review:${b.name}`, branchId: branchId(b), number: b.reviewNumber, draft: b.reviewDraft ?? false }]
  )
  const stored: Partial<Record<StoredType, { id: string }[]>> = { repository, task: tasks, branch, review }
  const objects = {
    list: async (type: StoredType, filter: { where?: Record<string, unknown>; ids?: string[] } = {}) =>
      (stored[type] ?? []).filter(
        (o) => (!filter.ids || filter.ids.includes(o.id)) && Object.entries(filter.where ?? {}).every(([k, v]) => Reflect.get(o, k) === v)
      ),
    get: async (type: StoredType, id: string) => (stored[type] ?? []).find((o) => o.id === id) ?? null,
    first: async (action: string, args: unknown) => (action === 'review.refresh' ? (refreshed.push(args), true) : forge),
  }
  return objects as unknown as BranchesDeps['objects']
}

// git's push: each one said (`repo name`); `refuse` makes origin refuse it, in git's words.
export function fakeGit(refuse: string | null = null) {
  const pushes: string[] = []
  return {
    pushes,
    git: {
      push: async (repo: string, name: string) => {
        pushes.push(`${repo} ${name}`)
        return refuse ? { ok: false, message: refuse } : { ok: true, message: 'poussée' }
      },
    },
  }
}

export function service(
  world: World,
  { tasks = [], settings = {}, git = fakeGit().git }: { tasks?: Task[]; settings?: Partial<SharedSettings>; git?: BranchesDeps['git'] } = {}
) {
  const shared = { ...SETTINGS, ...settings }
  const links: string[] = []
  const s = new BranchesService({ objects: objectsOf(world, tasks), shared: sharedOf(world, tasks, shared, links), git })
  return { s, shared, links }
}
