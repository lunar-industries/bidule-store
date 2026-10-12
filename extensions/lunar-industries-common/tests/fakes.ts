import type { ObjectFields, StoredObject, StoredType } from '@bidule/sdk/objects'
import type { Objects } from '../server/branches.ts'

// The core as the module sees it (taken from the fake cores of the Kanban, Branches and Claude modules): two repos,
// their branches, reviews and pipelines, the tasks, the `task → branch` links and the `noTask` marks, and the core's
// rule that links a branch by the task's reference in its name, run as the core does after a link or an unlink.

type Ref = { type: StoredType; id: string }
export type Link = { from: Ref; kind: string; to: Ref; origin: string }

const base = <T extends StoredType>(type: T, id: string, fields: ObjectFields[T], url: string | null = null) =>
  ({ id, type, provider: 'test', ref: null, url, properties: {}, ...fields }) as StoredObject<T>

export const repo = (id: string, path: string, label: string) =>
  base('repository', id, { path, label, remoteHost: null, remotePath: null, defaultBranch: 'main' })

export const branch = (id: string, name: string, patch: Partial<ObjectFields['branch']> = {}) =>
  base('branch', id, {
    repositoryId: 'r1',
    name,
    isDefault: false,
    ahead: 0,
    behind: 0,
    pushed: true,
    lastCommitAt: null,
    headSha: `sha-${id}`,
    base: null,
    ...patch,
  })

export const review = (id: string, branchId: string, number: number, state: 'open' | 'merged' | 'closed', url: string | null = null) =>
  base('review', id, { branchId, number, label: `MR !${number}`, state, draft: false, comments: null, title: null }, url)

export const pipeline = (id: string, branchId: string, status: 'ok' | 'fail' | 'running', url: string | null = null) =>
  base('pipeline', id, { branchId, headSha: `sha-${branchId}`, status }, url)

export const task = (id: string, ref: string | null = null) => ({
  ...base('task', id, { title: id, status: 'En cours', group: 'doing', role: 'owner', due: null, lastEdited: null }),
  ref,
})

export const linked = (taskId: string, branchId: string, origin = 'manual'): Link => ({
  from: { type: 'task', id: taskId },
  kind: 'branch',
  to: { type: 'branch', id: branchId },
  origin,
})

export function fakeCore(
  init: {
    repos?: StoredObject<'repository'>[]
    branches?: StoredObject<'branch'>[]
    reviews?: StoredObject<'review'>[]
    pipelines?: StoredObject<'pipeline'>[]
    tasks?: StoredObject<'task'>[]
    links?: Link[]
    // The types someone provides; by default, every type given.
    providers?: StoredType[]
  } = {}
) {
  const stored: Partial<Record<StoredType, { id: string }[]>> = {
    repository: init.repos ?? [repo('r1', '/r/app', 'app'), repo('r2', '/r/api', 'api')],
    branch: init.branches ?? [],
    review: init.reviews ?? [],
    pipeline: init.pipelines ?? [],
    task: init.tasks ?? [task('t'), task('x')],
  }
  const provided = new Set(init.providers ?? (['repository', 'branch', 'review', 'pipeline', 'task'] as const))
  const links = [...(init.links ?? [])]
  // Each link and unlink, in order.
  const calls: string[] = []
  const same = (a: Ref, b: Ref) => a.type === b.type && a.id === b.id
  const refOf = (id: string) => (stored.task ?? []).find((t) => t.id === id && 'ref' in t && t.ref)
  // The core's rule on branch names, on one branch: linked or unlinked by hand, it keeps no link by name; otherwise
  // it is linked to the task whose reference starts its name. A link by name goes only when its task has a reference.
  const discover = (id: string) => {
    const b = (stored.branch ?? []).find((x) => x.id === id)
    if (!b) return
    const byHand = links.some(
      (l) => (l.kind === 'branch' && l.to.id === id && l.origin === 'manual') || (l.kind === 'noTask' && l.from.id === id)
    )
    const name = String(Reflect.get(b, 'name')).toLowerCase()
    const hit = byHand
      ? null
      : ((stored.task ?? []).find((t) => {
          const ref = Reflect.get(t, 'ref')
          return typeof ref === 'string' && name.startsWith(ref.toLowerCase())
        })?.id ?? null)
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i]
      if (l.kind === 'branch' && l.to.id === id && l.origin === 'ref' && l.from.id !== hit && refOf(l.from.id)) links.splice(i, 1)
    }
    if (hit && !links.some((l) => l.kind === 'branch' && l.to.id === id && l.from.id === hit))
      links.push({ from: { type: 'task', id: hit }, kind: 'branch', to: { type: 'branch', id }, origin: 'ref' })
  }
  const said = (from: Ref, kind: string, to: Ref) => (kind === 'noTask' ? from.id : to.id)
  const objects = {
    providers: (type: StoredType) => (provided.has(type) ? ['test'] : []),
    list: async (type: StoredType, filter: { ids?: string[]; where?: Record<string, unknown> } = {}) =>
      (stored[type] ?? []).filter(
        (o) =>
          (!filter.ids || filter.ids.includes(o.id)) && Object.entries(filter.where ?? {}).every(([k, v]) => Reflect.get(o, k) === v)
      ),
    get: async (type: StoredType, id: string) => (stored[type] ?? []).find((o) => o.id === id) ?? null,
    relations: async ({ kind }: { kind: string }) => links.filter((l) => l.kind === kind).map((l) => ({ ...l })),
    related: async (id: string, filter: { kind?: string; type?: StoredType } = {}) =>
      links
        .filter((l) => l.from.id === id || l.to.id === id)
        .map((l) =>
          l.from.id === id
            ? { kind: l.kind, type: l.to.type, id: l.to.id, origin: l.origin, outgoing: true }
            : { kind: l.kind, type: l.from.type, id: l.from.id, origin: l.origin, outgoing: false }
        )
        .filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.type || r.type === filter.type)),
    // As the core: a rule never overrides the user's link.
    link: async (from: Ref, kind: string, to: Ref, origin: string) => {
      calls.push(`link ${kind} ${from.id} ${to.id}`)
      const current = links.find((l) => l.kind === kind && same(l.from, from) && same(l.to, to))
      if (current?.origin === 'manual' && origin !== 'manual') return
      if (current) current.origin = origin
      else links.push({ from, kind, to, origin })
      discover(said(from, kind, to))
    },
    unlink: async (from: Ref, kind: string, to: Ref) => {
      calls.push(`unlink ${kind} ${from.id} ${to.id}`)
      const at = links.findIndex((l) => l.kind === kind && same(l.from, from) && same(l.to, to))
      if (at < 0) return
      links.splice(at, 1)
      discover(said(from, kind, to))
    },
  }
  // The links of a branch, as [kind, from, origin].
  const linksOf = (id: string) => links.filter((l) => l.to.id === id || l.from.id === id).map((l) => [l.kind, l.from.id, l.origin])
  return { objects: objects as unknown as Objects, links, calls, linksOf }
}
