import type { ForgeClient, ForgeJob, NewReview } from '@bidule/sdk/forges'
import type { StoredObject, StoredType } from '@bidule/sdk/objects'
import type { Task } from '@bidule/sdk/tasks'
import type { ListedBranch } from '../contract.ts'
import { BranchesService, type BranchesDeps } from '../server/service.ts'

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
    ci: null,
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

// git's actions the page uses, recording them, over these branches; the forge `review.forge` gives (null: none).
export function fakeGit(branches: Spec[], forge: ForgeClient | null) {
  const links: string[] = []
  let syncs = 0
  const git: ReturnType<BranchesDeps['git']> = {
    link: async (repo, name, taskId) => {
      links.push(`${repo} ${name} ${taskId}`)
      return branches.some((b) => b.repo === repo && b.name === name)
    },
    sync: async () => void syncs++,
  }
  return { world: { branches, forge, git }, links, syncs: () => syncs }
}

type World = ReturnType<typeof fakeGit>['world']

// The core's objects for these branches: their repos, the branches, their reviews and pipelines, their tasks' links.
function objectsOf({ branches, forge }: World, tasks: Task[]): BranchesDeps['objects'] {
  const base = { provider: 'git', ref: null, url: null, properties: {} }
  const repoId = (path: string) => `repo:${path}`
  const branchId = (b: Spec) => `${b.repo}\n${b.name}`
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
  const branch: StoredObject<'branch'>[] = branches.map((b) => ({
    ...base,
    id: branchId(b),
    type: 'branch',
    repositoryId: repoId(b.repo),
    name: b.name,
    isDefault: b.isDefault,
    ahead: 0,
    behind: 0,
    pushed: true,
    lastCommitAt: b.lastCommitAt,
    headSha: b.headSha,
    base: null,
  }))
  const review: StoredObject<'review'>[] = branches.flatMap((b) =>
    b.reviewNumber && b.reviewState
      ? [
          {
            ...base,
            provider: 'gitlab',
            id: `review:${branchId(b)}`,
            type: 'review' as const,
            branchId: branchId(b),
            number: b.reviewNumber,
            label: `MR !${b.reviewNumber}`,
            state: b.reviewState,
            draft: false,
            comments: null,
            title: null,
          },
        ]
      : []
  )
  const pipeline: StoredObject<'pipeline'>[] = branches.flatMap((b) =>
    b.ci && b.ci !== 'merged'
      ? [{ ...base, provider: 'gitlab', id: `pipeline:${branchId(b)}`, type: 'pipeline' as const, branchId: branchId(b), headSha: b.headSha, status: b.ci }]
      : []
  )
  const stored: Partial<Record<StoredType, { id: string }[]>> = { repository, branch, review, pipeline, task: tasks }
  const relations = branches.flatMap((b) =>
    b.taskId ? [{ from: { type: 'task' as const, id: b.taskId }, kind: 'branch', to: { type: 'branch' as const, id: branchId(b) }, origin: 'manual' }] : []
  )
  const objects = {
    list: async (type: StoredType, filter: { where?: Record<string, unknown> } = {}) =>
      (stored[type] ?? []).filter((o) => Object.entries(filter.where ?? {}).every(([k, v]) => Reflect.get(o, k) === v)),
    get: async (type: StoredType, id: string) => (stored[type] ?? []).find((o) => o.id === id) ?? null,
    relations: async () => relations,
    first: async () => forge,
  }
  return objects as unknown as BranchesDeps['objects']
}

export function service(world: World, { tasks = [], settings = {} }: { tasks?: Task[]; settings?: Record<string, string> } = {}) {
  const saved: Record<string, string> = { ...settings }
  let changed = 0
  const s = new BranchesService({
    objects: objectsOf(world, tasks),
    git: () => world.git,
    setting: async (key) => saved[key],
    save: async (key, value) => void (saved[key] = value),
    changed: () => void changed++,
  })
  return { s, saved, changed: () => changed }
}
