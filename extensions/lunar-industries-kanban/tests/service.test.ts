import type { SharedBranch } from '@bidule/ext-lunar-industries-common/contract'
import type { ForgeClient } from '@bidule/sdk/forges'
import { describe, expect, test } from 'vitest'
import { KanbanService, type Objects, type Shared } from '../server/service.ts'

// A branch as lunar-industries-common gives it (its join of the core's objects is tested there).
const branch = (name: string, patch: Partial<SharedBranch> = {}): SharedBranch => ({
  id: name,
  repositoryId: 'r1',
  repo: '/r/app',
  repoLabel: 'app',
  name,
  isDefault: false,
  integration: false,
  taskId: null,
  lastCommitAt: null,
  headSha: `sha-${name}`,
  reviewNumber: null,
  reviewRef: null,
  reviewState: null,
  ci: null,
  url: null,
  ...patch,
})

// The core as the module sees it: lunar-industries-common's commands (each link said: `branch→task`), a task, a forge.
function fakeCore(init: { branches?: SharedBranch[]; available?: boolean; forge?: Partial<ForgeClient> } = {}) {
  const branches = init.branches ?? []
  const written: string[] = []
  const shared: Shared = {
    branches: async (filter) => ({
      available: init.available ?? true,
      branches: branches.filter((b) => (!filter.repo || b.repo === filter.repo) && (!filter.name || b.name === filter.name)),
    }),
    link: async ({ name, taskId }) => {
      const b = branches.find((x) => x.name === name)
      if (b) b.taskId = taskId
      written.push(`${name}→${taskId}`)
      return { linked: Boolean(b) }
    },
  }
  const objects = {
    get: async (_type: string, id: string) => (['t', 'x'].includes(id) ? { id } : null),
    first: async () => init.forge ?? null,
  } as unknown as Objects
  return { service: new KanbanService(objects, shared), written }
}

describe('the cards’ branches', () => {
  test('without a provider of branches, no branch and no error', async () => {
    const { service } = fakeCore({ available: false })
    expect(await service.branches()).toEqual({ available: false, branches: [] })
    await expect(service.setBranches('t', [])).rejects.toThrow(/fournit de branches/)
  })

  test('the repos’ default branches and the integration ones are left out', async () => {
    const { service } = fakeCore({
      branches: [branch('main', { isDefault: true }), branch('develop', { integration: true }), branch('feat/a', { taskId: 't' })],
    })
    const { branches } = await service.branches()
    expect(branches).toEqual([
      {
        repo: '/r/app',
        repoLabel: 'app',
        name: 'feat/a',
        taskId: 't',
        isDefault: false,
        lastCommitAt: null,
        reviewNumber: null,
        reviewRef: null,
        reviewState: null,
        ci: null,
        // Kept, for a card's mark to open its review at once.
        url: null,
      },
    ])
  })

  test('a task’s branches are exactly those given: others unlinked, new ones linked, kept ones untouched', async () => {
    const { service, written } = fakeCore({
      branches: [branch('kept', { taskId: 't' }), branch('dropped', { taskId: 't' }), branch('new', { taskId: 'x' })],
    })
    const after = await service.setBranches('t', [
      { repo: '/r/app', name: 'kept' },
      { repo: '/r/app', name: 'new' },
    ])
    expect(written).toEqual(['dropped→null', 'new→t'])
    expect(after.branches.filter((b) => b.taskId === 't').map((b) => b.name)).toEqual(['kept', 'new'])
    expect(after.branches.find((b) => b.name === 'dropped')?.taskId).toBeNull()
  })

  test('an unknown branch or task changes nothing', async () => {
    const { service, written } = fakeCore({ branches: [branch('dropped', { taskId: 't' })] })
    await expect(service.setBranches('t', [{ repo: '/r/app', name: 'nope' }])).rejects.toThrow(/inconnue/)
    await expect(service.setBranches('gone', [{ repo: '/r/app', name: 'dropped' }])).rejects.toThrow(/Tâche inconnue/)
    expect(written).toEqual([])
  })

  test('a mark leads to the review, else the pipeline, else asks the forge now, else nowhere', async () => {
    const ref = { repo: '/r/app', name: 'feat/a' }
    const known = fakeCore({ branches: [branch('feat/a', { url: 'https://r/1' })] })
    expect(await known.service.reviewUrl(ref)).toBe('https://r/1')
    const withReview = fakeCore({
      branches: [branch('feat/a')],
      forge: { review: async () => ({ number: 1, state: 'open', draft: false, url: 'https://r/9', description: '' }) },
    })
    expect(await withReview.service.reviewUrl(ref)).toBe('https://r/9')
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
    expect(await withPipeline.service.reviewUrl(ref)).toBe('https://p/3')
    expect(pipelines).toEqual(['sha-feat/a'])
    expect(await fakeCore({ branches: [branch('feat/a')] }).service.reviewUrl(ref)).toBeNull()
    expect(await fakeCore().service.reviewUrl(ref)).toBeNull()
  })
})
