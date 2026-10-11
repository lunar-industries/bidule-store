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

type Ref = { type: StoredType; id: string }
export type Relation = { from: Ref; kind: string; to: Ref; origin: string }

const repoId = (path: string) => `repo:${path}`
export const branchId = (b: { repo: string; name: string }) => `${b.repo}\n${b.name}`

// These branches as the core has them, with their tasks' links (each `taskId` set by hand); the forge `review.forge`
// gives (null: none), and what `review.refresh` was asked.
export function fakeWorld(branches: Spec[], forge: ForgeClient | null) {
  // What the forge was asked to read again (`review.refresh`).
  const refreshed: unknown[] = []
  const relations: Relation[] = branches.flatMap((b) =>
    b.taskId ? [{ from: { type: 'task' as const, id: b.taskId }, kind: 'branch', to: { type: 'branch' as const, id: branchId(b) }, origin: 'manual' }] : []
  )
  return { world: { branches, forge, refreshed, relations }, refreshed, relations }
}

type World = ReturnType<typeof fakeWorld>['world']

/**
 * The core's rule on branch names (`discoverBranches`), run after each change as the core does: a branch not linked
 * nor unlinked by hand, whose name holds a task's reference, is linked to that task (origin `ref`), and only to it.
 */
function discover(relations: Relation[], branches: Spec[], tasks: Task[]) {
  const byHand = new Set([
    ...relations.filter((l) => l.kind === 'branch' && l.origin === 'manual').map((l) => l.to.id),
    ...relations.filter((l) => l.kind === 'noTask').map((l) => l.from.id),
  ])
  for (const b of branches) {
    const id = branchId(b)
    if (b.isDefault || byHand.has(id)) continue
    const hit = tasks.find((t) => t.ref && b.name.toLowerCase().includes(t.ref.toLowerCase()))?.id ?? null
    for (let i = relations.length - 1; i >= 0; i--) {
      const l = relations[i]
      if (l.kind === 'branch' && l.to.id === id && l.origin === 'ref' && l.from.id !== hit) relations.splice(i, 1)
    }
    if (hit && !relations.some((l) => l.kind === 'branch' && l.to.id === id && l.from.id === hit))
      relations.push({ from: { type: 'task', id: hit }, kind: 'branch', to: { type: 'branch', id }, origin: 'ref' })
  }
}

// The core's objects for these branches: their repos, the branches, their reviews and pipelines, their tasks' links.
function objectsOf({ branches, forge, refreshed, relations }: World, tasks: Task[]): BranchesDeps['objects'] {
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
  const same = (a: Ref, b: Ref) => a.type === b.type && a.id === b.id
  const objects = {
    list: async (type: StoredType, filter: { where?: Record<string, unknown> } = {}) =>
      (stored[type] ?? []).filter((o) => Object.entries(filter.where ?? {}).every(([k, v]) => Reflect.get(o, k) === v)),
    get: async (type: StoredType, id: string) => (stored[type] ?? []).find((o) => o.id === id) ?? null,
    relations: async (filter: { kind: string }) => relations.filter((l) => l.kind === filter.kind).map((l) => ({ ...l })),
    related: async (id: string, filter: { kind?: string; type?: StoredType } = {}) =>
      relations
        .filter((l) => l.from.id === id || l.to.id === id)
        .map((l) =>
          l.from.id === id
            ? { kind: l.kind, type: l.to.type, id: l.to.id, origin: l.origin, outgoing: true }
            : { kind: l.kind, type: l.from.type, id: l.from.id, origin: l.origin, outgoing: false }
        )
        .filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.type || r.type === filter.type)),
    // As the core: a rule never overrides the user's link; each change runs the rule on branch names again.
    link: async (from: Ref, kind: string, to: Ref, origin: string) => {
      const current = relations.find((l) => l.kind === kind && same(l.from, from) && same(l.to, to))
      if (current?.origin === 'manual' && origin !== 'manual') return
      if (current) current.origin = origin
      else relations.push({ from, kind, to, origin })
      discover(relations, branches, tasks)
    },
    unlink: async (from: Ref, kind: string, to: Ref) => {
      const at = relations.findIndex((l) => l.kind === kind && same(l.from, from) && same(l.to, to))
      if (at < 0) return
      relations.splice(at, 1)
      discover(relations, branches, tasks)
    },
    first: async (action: string, args: unknown) => (action === 'review.refresh' ? (refreshed.push(args), true) : forge),
  }
  return objects as unknown as BranchesDeps['objects']
}

export function service(world: World, { tasks = [], settings = {} }: { tasks?: Task[]; settings?: Record<string, string> } = {}) {
  const saved: Record<string, string> = { ...settings }
  let changed = 0
  const s = new BranchesService({
    objects: objectsOf(world, tasks),
    setting: async (key) => saved[key],
    save: async (key, value) => void (saved[key] = value),
    changed: () => void changed++,
  })
  return { s, saved, changed: () => changed }
}
