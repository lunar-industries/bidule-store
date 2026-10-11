import type { ForgeClient } from '@bidule/sdk/forges'
import type { ObjectFields, StoredObject, StoredType } from '@bidule/sdk/objects'
import { describe, expect, test } from 'vitest'
import { KanbanService, type Objects } from '../server/service.ts'

type Ref = { type: StoredType; id: string }
type Link = { from: Ref; kind: string; to: Ref; origin: string }

const base = <T extends StoredType>(type: T, id: string, fields: ObjectFields[T], url: string | null = null) =>
  ({ id, type, provider: 'test', ref: null, url, properties: {}, ...fields }) as StoredObject<T>

const repo = base('repository', 'r1', {
  path: '/r/app',
  label: 'app',
  remoteHost: null,
  remotePath: null,
  defaultBranch: 'main',
})

// A branch's object: its id is its name.
const branch = (name: string, patch: Partial<ObjectFields['branch']> = {}) =>
  base('branch', name, {
    repositoryId: 'r1',
    name,
    isDefault: false,
    ahead: 0,
    behind: 0,
    pushed: true,
    lastCommitAt: null,
    headSha: `sha-${name}`,
    base: null,
    ...patch,
  })

const task = (id: string) =>
  base('task', id, { title: id, status: 'En cours', group: 'doing', role: 'owner', due: null, lastEdited: null })

const linked = (taskId: string, branchId: string, origin = 'manual'): Link => ({
  from: { type: 'task', id: taskId },
  kind: 'branch',
  to: { type: 'branch', id: branchId },
  origin,
})

// The core as the module sees it: its objects, their links (each one written is said: `branch→task`), a forge.
function fakeCore(
  init: {
    branches?: StoredObject<'branch'>[]
    links?: Link[]
    reviews?: StoredObject<'review'>[]
    pipelines?: StoredObject<'pipeline'>[]
    forge?: Partial<ForgeClient>
  } = {}
) {
  const links = [...(init.links ?? [])]
  const written: string[] = []
  // Every change, in order (`+` a link, `-` an unlink): the core's rule on names runs again after each one.
  const changes: string[] = []
  const objects: Record<string, { id: string }[]> = {
    repository: [repo],
    branch: init.branches ?? [],
    review: init.reviews ?? [],
    pipeline: init.pipelines ?? [],
    task: [task('t'), task('x')],
  }
  const same = (l: Link, from: Ref, kind: string, to: Ref) => l.from.id === from.id && l.kind === kind && l.to.id === to.id
  const core = {
    providers: (type: string) => (init.branches || type === 'task' ? (objects[type]?.length ? ['test'] : []) : []),
    list: async (type: string) => objects[type] ?? [],
    get: async (type: string, id: string) => objects[type]?.find((o) => o.id === id) ?? null,
    relations: async ({ kind }: { kind: string }) => links.filter((l) => l.kind === kind),
    related: async (id: string, { kind }: { kind: string }) =>
      links.filter((l) => l.kind === kind && l.to.id === id).map((l) => ({ ...l.from, kind, origin: l.origin, outgoing: false })),
    link: async (from: Ref, kind: string, to: Ref, origin: string) => {
      links.push({ from, kind, to, origin })
      written.push(`${to.id}→${kind === 'noTask' ? null : from.id}`)
      changes.push(`+${kind} ${from.id} ${to.id}`)
    },
    unlink: async (from: Ref, kind: string, to: Ref) => {
      for (let i = links.length - 1; i >= 0; i--) if (same(links[i], from, kind, to)) links.splice(i, 1)
      changes.push(`-${kind} ${from.id} ${to.id}`)
    },
    first: async () => init.forge ?? null,
  } as unknown as Objects
  return { core, written, changes }
}

describe('the cards’ branches', () => {
  test('without a provider of branches, no branch and no error', async () => {
    const service = new KanbanService(fakeCore().core)
    expect(await service.branches()).toEqual({ available: false, branches: [] })
    await expect(service.setBranches('t', [])).rejects.toThrow(/fournit de branches/)
  })

  test('the repos’ default branches are left out', async () => {
    const { core } = fakeCore({ branches: [branch('main', { isDefault: true }), branch('feat/a')] })
    const { branches } = await new KanbanService(core).branches()
    expect(branches.map((b) => [b.repo, b.repoLabel, b.name])).toEqual([['/r/app', 'app', 'feat/a']])
  })

  test('the integration branches of the setting are left out too, whatever their case', async () => {
    const { core } = fakeCore({ branches: [branch('develop'), branch('Factory'), branch('feat/a')] })
    const { branches } = await new KanbanService(core).branches()
    expect(branches.map((b) => b.name)).toEqual(['feat/a'])
    const own = await new KanbanService(core, async () => 'feat/a').branches()
    expect(own.branches.map((b) => b.name)).toEqual(['develop', 'Factory'])
  })

  test('a branch’s task is the core’s link, the one made by hand first', async () => {
    const { core } = fakeCore({
      branches: [branch('a'), branch('b')],
      links: [linked('x', 'a', 'ref'), linked('t', 'a', 'manual'), linked('x', 'b', 'ref')],
    })
    const { branches } = await new KanbanService(core).branches()
    expect(branches.map((b) => [b.name, b.taskId])).toEqual([
      ['a', 't'],
      ['b', 'x'],
    ])
  })

  test('a task’s branches are exactly those given: others unlinked, new ones linked, kept ones untouched', async () => {
    const { core, written } = fakeCore({
      branches: [branch('kept'), branch('dropped'), branch('new')],
      links: [linked('t', 'kept', 'ref'), linked('t', 'dropped'), linked('x', 'new')],
    })
    const after = await new KanbanService(core).setBranches('t', [
      { repo: '/r/app', name: 'kept' },
      { repo: '/r/app', name: 'new' },
    ])
    expect(written).toEqual(['dropped→null', 'new→t'])
    expect(after.branches.filter((b) => b.taskId === 't').map((b) => b.name)).toEqual(['kept', 'new'])
    expect(after.branches.find((b) => b.name === 'dropped')?.taskId).toBeNull()
  })

  test('the link by hand comes before the others go, so that the rule on names never sees the branch free', async () => {
    const { core, changes } = fakeCore({
      branches: [branch('dropped'), branch('new')],
      links: [linked('t', 'dropped', 'ref'), linked('x', 'new', 'ref')],
    })
    await new KanbanService(core).setBranches('t', [{ repo: '/r/app', name: 'new' }])
    expect(changes).toEqual([
      '+noTask dropped dropped',
      '-branch t dropped',
      '+branch t new',
      '-branch x new',
      '-noTask new new',
    ])
  })

  test('an unknown branch or task changes nothing', async () => {
    const { core, written } = fakeCore({ branches: [branch('dropped')], links: [linked('t', 'dropped')] })
    const service = new KanbanService(core)
    await expect(service.setBranches('t', [{ repo: '/r/app', name: 'nope' }])).rejects.toThrow(/inconnue/)
    await expect(service.setBranches('gone', [{ repo: '/r/app', name: 'dropped' }])).rejects.toThrow(/Tâche inconnue/)
    expect(written).toEqual([])
  })

  test('a branch’s marks: its latest review, its pipeline, merged once its review is', async () => {
    const review = (id: string, branchId: string, number: number, state: 'open' | 'merged') =>
      base('review', id, { branchId, number, label: `MR !${number}`, state, draft: false, comments: null, title: null })
    const { core } = fakeCore({
      branches: [branch('open'), branch('merged'), branch('ci'), branch('bare')],
      reviews: [review('r1', 'open', 3, 'open'), review('r2', 'open', 7, 'open'), review('r3', 'merged', 4, 'merged')],
      pipelines: [base('pipeline', 'p1', { branchId: 'ci', headSha: 'sha-ci', status: 'fail' })],
    })
    const { branches } = await new KanbanService(core).branches()
    expect(branches.map((b) => [b.name, b.reviewRef, b.reviewNumber, b.reviewState, b.ci])).toEqual([
      ['open', 'MR !7', 7, 'open', 'none'],
      ['merged', 'MR !4', 4, 'merged', 'merged'],
      ['ci', null, null, null, 'fail'],
      ['bare', null, null, null, null],
    ])
  })

  test('a mark leads to the review, else the pipeline, else asks the forge now, else nowhere', async () => {
    const ref = { repo: '/r/app', name: 'feat/a' }
    const known = fakeCore({
      branches: [branch('feat/a')],
      reviews: [base('review', 'r', { branchId: 'feat/a', number: 1, label: '#1', state: 'open', draft: false, comments: null, title: null }, 'https://r/1')],
    })
    expect(await new KanbanService(known.core).reviewUrl(ref)).toBe('https://r/1')
    const ci = fakeCore({
      branches: [branch('feat/a')],
      pipelines: [base('pipeline', 'p', { branchId: 'feat/a', headSha: 'sha-feat/a', status: 'ok' }, 'https://p/2')],
    })
    expect(await new KanbanService(ci.core).reviewUrl(ref)).toBe('https://p/2')
    const withReview = fakeCore({
      branches: [branch('feat/a')],
      forge: { review: async () => ({ number: 1, state: 'open', draft: false, url: 'https://r/9', description: '' }) },
    })
    expect(await new KanbanService(withReview.core).reviewUrl(ref)).toBe('https://r/9')
    const pipelines: string[] = []
    const withPipeline = fakeCore({
      branches: [branch('feat/a')],
      forge: {
        review: async () => null,
        pipeline: async (sha: string) => {
          pipelines.push(sha)
          return { id: 3, status: 'ok', url: 'https://p/3' }
        },
      },
    })
    expect(await new KanbanService(withPipeline.core).reviewUrl(ref)).toBe('https://p/3')
    expect(pipelines).toEqual(['sha-feat/a'])
    const noForge = fakeCore({ branches: [branch('feat/a')] })
    expect(await new KanbanService(noForge.core).reviewUrl(ref)).toBeNull()
  })
})
