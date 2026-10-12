import { describe, expect, it } from 'vitest'
import type { ServerContext } from '@bidule/api/extensions'
import type { Task } from '@bidule/sdk/tasks'
import { branchAccess, taskAccess, type BranchObjects } from '../server/objects.ts'

// The core's tasks as the sessions read them (ctx.objects): two providers sharing a status, a task the user is not on,
// and a provider that neither shows a page nor takes comments.

const task = (patch: Partial<Task>): Task => ({
  id: 't1',
  type: 'task',
  provider: 'notion',
  ref: null,
  url: null,
  properties: {},
  title: 'Tâche',
  status: 'À faire',
  group: 'todo',
  role: 'owner',
  due: null,
  lastEdited: null,
  ...patch,
})

function fakeCtx(options: { providers?: string[] } = {}) {
  const tasks = [
    task({ id: 't1', ref: 'ID-7', title: 'Ajout rôle' }),
    task({ id: 't2', ref: 'ID-8', title: 'Pas à moi', role: null }),
    task({ id: 't3', ref: 'PL-1', title: 'Chez Plane', provider: 'plane' }),
  ]
  const acted: string[] = []
  const providers = options.providers ?? ['notion', 'plane']
  const answering: Record<string, string[]> = { 'task.page': ['notion'], 'task.comment': ['notion'], 'task.search': ['notion'] }
  const objects = {
    providers: (_type: string, action?: string) => (action ? (answering[action] ?? []) : providers),
    columns: async () => [
      { name: 'À faire', color: 'neutral', group: 'todo', provider: 'notion' },
      { name: 'À faire', color: 'neutral', group: 'todo', provider: 'plane' },
      { name: 'En cours', color: 'blue', group: 'doing', provider: 'notion' },
    ],
    list: async (_type: string, filter: { ids?: string[] } = {}) => tasks.filter((t) => !filter.ids || filter.ids.includes(t.id)),
    get: async (_type: string, id: string) => tasks.find((t) => t.id === id) ?? null,
    act: async (action: string, id: string, args: unknown) => {
      acted.push(`${action} ${id} ${JSON.stringify(args)}`)
      return action === 'task.page' ? { text: 'Contenu', comments: [] } : undefined
    },
    run: async (_action: string, { q }: { q: string }) => (q === 'rôle' ? ['t1', 't2'] : []),
  }
  return { ctx: { objects } as unknown as ServerContext, acted }
}

describe('the core’s tasks', () => {
  it('none without a provider of tasks', () => {
    expect(taskAccess(fakeCtx({ providers: [] }).ctx)).toBeNull()
  })

  it('the board: the user’s tasks, a status two tools share as one column', async () => {
    const board = await taskAccess(fakeCtx().ctx)?.board()
    expect(board?.columns.map((c) => c.name)).toEqual(['À faire', 'En cours'])
    expect(board?.tasks.map((t) => t.id)).toEqual(['t1', 't3'])
  })

  it('finds a task by its id or its reference in any case, the user’s or not', async () => {
    const tasks = taskAccess(fakeCtx().ctx)
    expect((await tasks?.find('t3'))?.title).toBe('Chez Plane')
    expect((await tasks?.find(' id-7 '))?.id).toBe('t1')
    expect((await tasks?.find('ID-8'))?.id).toBe('t2')
    expect(await tasks?.find('ID-99')).toBeNull()
  })

  it('searches the tools that search', async () => {
    const found = await taskAccess(fakeCtx().ctx)?.search('rôle')
    expect(found?.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('a page and a comment go to the task’s provider, when it answers them', async () => {
    const { ctx, acted } = fakeCtx()
    const tasks = taskAccess(ctx)
    expect(await tasks?.page('t1')).toEqual({ text: 'Contenu', comments: [] })
    expect(await tasks?.page('t3')).toEqual({ text: '', comments: [] })
    await tasks?.comment('t1', 'Vu')
    await expect(tasks?.comment('t3', 'Vu')).rejects.toThrow('La source de tâches ne prend pas de commentaires')
    await tasks?.move('t3', 'En cours')
    expect(acted).toEqual(['task.page t1 {}', 'task.comment t1 {"text":"Vu"}', 'task.move t3 {"status":"En cours"}'])
  })
})

// The core's branches as the tools read and link them: two repos, a task's branches with their review and pipeline,
// and the core's rule that links a branch by the task's reference in its name, run after each change as the core does.
function fakeBranches() {
  const base = { provider: 'git', ref: null, url: null, properties: {} }
  type Ref = { type: string; id: string }
  type Link = { from: Ref; kind: string; to: Ref; origin: string }
  const stored: Record<string, Record<string, unknown>[]> = {
    repository: [
      { ...base, id: 'r1', type: 'repository', path: '/r/app', label: 'app' },
      { ...base, id: 'r2', type: 'repository', path: '/r/api', label: 'api' },
    ],
    branch: [
      { ...base, id: 'b1', type: 'branch', repositoryId: 'r1', name: 'id-7-ajout-role', isDefault: false },
      { ...base, id: 'b2', type: 'branch', repositoryId: 'r2', name: 'id-7-api', isDefault: false },
      { ...base, id: 'b3', type: 'branch', repositoryId: 'r1', name: 'autre', isDefault: false },
    ],
    review: [
      { ...base, provider: 'gitlab', id: 'v1', type: 'review', branchId: 'b1', number: 2, label: 'MR !2', state: 'closed' },
      { ...base, provider: 'gitlab', id: 'v2', type: 'review', branchId: 'b1', number: 3, label: 'MR !3', state: 'open' },
      { ...base, provider: 'gitlab', id: 'v3', type: 'review', branchId: 'b2', number: 4, label: 'MR !4', state: 'merged' },
    ],
    pipeline: [{ ...base, provider: 'gitlab', id: 'p1', type: 'pipeline', branchId: 'b1', status: 'fail' }],
  }
  const refs: Record<string, string> = { t7: 'id-7', t8: 'id-8' }
  const links: Link[] = []
  const same = (a: Ref, b: Ref) => a.type === b.type && a.id === b.id
  // The core's rule on branch names, as simple as these names need, on these branches: one linked or unlinked by hand
  // keeps no link by name.
  const discover = (ids: string[]) => {
    for (const b of stored.branch.filter((x) => ids.includes(String(x.id)))) {
      const id = String(b.id)
      const byHand = links.some(
        (l) => (l.kind === 'branch' && l.to.id === id && l.origin === 'manual') || (l.kind === 'noTask' && l.from.id === id)
      )
      const hit = byHand ? null : (Object.entries(refs).find(([, ref]) => String(b.name).startsWith(ref))?.[0] ?? null)
      for (let i = links.length - 1; i >= 0; i--)
        if (links[i].kind === 'branch' && links[i].to.id === id && links[i].origin === 'ref' && links[i].from.id !== hit) links.splice(i, 1)
      if (hit && !links.some((l) => l.kind === 'branch' && l.to.id === id && l.from.id === hit))
        links.push({ from: { type: 'task', id: hit }, kind: 'branch', to: { type: 'branch', id }, origin: 'ref' })
    }
  }
  // After a link or an unlink, the branch whose task it says, alone.
  const said = (from: Ref, kind: string, to: Ref) =>
    kind === 'branch' && to.type === 'branch' ? [to.id] : kind === 'noTask' ? [from.id] : []
  discover(stored.branch.map((b) => String(b.id)))
  const objects = {
    list: async (type: string, filter: { ids?: string[]; where?: Record<string, unknown> } = {}) =>
      (stored[type] ?? []).filter(
        (o) =>
          (!filter.ids || filter.ids.includes(String(o.id))) &&
          Object.entries(filter.where ?? {}).every(([k, v]) => o[k] === v)
      ),
    related: async (id: string, filter: { kind?: string; type?: string } = {}) =>
      links
        .filter((l) => l.from.id === id || l.to.id === id)
        .map((l) =>
          l.from.id === id
            ? { kind: l.kind, type: l.to.type, id: l.to.id, origin: l.origin, outgoing: true }
            : { kind: l.kind, type: l.from.type, id: l.from.id, origin: l.origin, outgoing: false }
        )
        .filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.type || r.type === filter.type)),
    relations: async (filter: { kind: string }) => links.filter((l) => l.kind === filter.kind),
    // As the core: a rule never overrides the user's link; a link saying a branch's task runs the rule on that branch.
    link: async (from: Ref, kind: string, to: Ref, origin: string) => {
      const current = links.find((l) => l.kind === kind && same(l.from, from) && same(l.to, to))
      if (current?.origin === 'manual' && origin !== 'manual') return
      if (current) current.origin = origin
      else links.push({ from, kind, to, origin })
      if (origin !== 'ref') discover(said(from, kind, to))
    },
    unlink: async (from: Ref, kind: string, to: Ref) => {
      const at = links.findIndex((l) => l.kind === kind && same(l.from, from) && same(l.to, to))
      if (at < 0) return
      links.splice(at, 1)
      discover(said(from, kind, to))
    },
  }
  const linksOf = (branch: string) =>
    links.filter((l) => l.to.id === branch || l.from.id === branch).map((l) => [l.kind, l.from.id, l.origin])
  return { branches: branchAccess(objects as unknown as BranchObjects), linksOf }
}

describe('the core’s branches', () => {
  it('a task’s branches by repo label, with their latest review and their CI', async () => {
    const { branches } = fakeBranches()
    expect(await branches.ofTask('t7')).toEqual([
      { repo: '/r/api', repoLabel: 'api', name: 'id-7-api', review: 'MR !4', ci: 'merged' },
      { repo: '/r/app', repoLabel: 'app', name: 'id-7-ajout-role', review: 'MR !3', ci: 'fail' },
    ])
    expect(await branches.ofTask('t8')).toEqual([])
  })

  it('a branch’s task, by its repo’s path; none for a branch unknown or without one', async () => {
    const { branches } = fakeBranches()
    expect(await branches.taskOf('/r/app', 'id-7-ajout-role')).toBe('t7')
    expect(await branches.taskOf('/r/app', 'autre')).toBeNull()
    expect(await branches.taskOf('/r/app', 'nope')).toBeNull()
    expect(await branches.taskOf('/elsewhere', 'id-7-ajout-role')).toBeNull()
  })

  it('a link by hand: its other tasks go, and the rule on names does not link it back', async () => {
    const { branches, linksOf } = fakeBranches()
    expect(linksOf('b1')).toEqual([['branch', 't7', 'ref']])
    expect(await branches.link('/r/app', 'id-7-ajout-role', 't8')).toBe(true)
    expect(linksOf('b1')).toEqual([['branch', 't8', 'manual']])
    expect(await branches.taskOf('/r/app', 'id-7-ajout-role')).toBe('t8')
    expect(await branches.link('/r/app', 'nope', 't8')).toBe(false)
  })
})
