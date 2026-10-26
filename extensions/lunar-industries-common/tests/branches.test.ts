import { describe, expect, test } from 'vitest'
import { linkByHand, setTasksByHand, sharedBranches } from '../server/branches.ts'
import { fakeCore, state } from './fakes.ts'

const NONE = new Set<string>()

describe('the branches as the core has them', () => {
  test('without a provider of branches, none, and said', async () => {
    const { objects } = fakeCore({ branches: [state('a', 'a')], providers: ['repository', 'task'] })
    expect(await sharedBranches(objects, NONE, {})).toEqual({ available: false, branches: [] })
  })

  test('each with its repo, its tasks (by hand first), its review and its CI as the core says them', async () => {
    const { objects } = fakeCore({
      branches: [
        state('a', 'feat/a', {
          tasks: [
            { id: 'x', origin: 'ref' },
            { id: 't', origin: 'manual' },
          ],
          review: {
            id: 'v', provider: 'gitlab', url: 'https://r/7', number: 7, label: 'MR !7', state: 'open', draft: false,
            comments: null, title: null,
          },
          ci: 'none',
        }),
        state('b', 'feat/b', { repositoryId: 'r2', pipeline: { id: 'p', provider: 'gitlab', url: 'https://p/1', status: 'fail', headSha: null }, ci: 'fail' }),
      ],
    })
    const { branches } = await sharedBranches(objects, NONE, {})
    expect(branches.map((b) => [b.name, b.repo, b.repoLabel, b.taskId, b.taskIds, b.reviewRef, b.ci, b.url])).toEqual([
      ['feat/a', '/r/app', 'app', 't', ['t', 'x'], 'MR !7', 'none', 'https://r/7'],
      ['feat/b', '/r/api', 'api', null, [], null, 'fail', 'https://p/1'],
    ])
  })

  test('the integration branches: the repository’s, and the setting’s whatever their case; the default one says so on its own', async () => {
    const { objects } = fakeCore({
      branches: [
        state('m', 'main', { isDefault: true, integration: true }),
        state('d', 'Develop'),
        state('o', 'orbit', { integration: true }),
        state('f', 'feat/a'),
      ],
    })
    const { branches } = await sharedBranches(objects, new Set(['develop']), {})
    expect(branches.map((b) => [b.name, b.isDefault, b.integration])).toEqual([
      ['main', true, false],
      ['Develop', false, true],
      ['orbit', false, true],
      ['feat/a', false, false],
    ])
  })

  test('a task’s branches only, or one repo’s, or one branch', async () => {
    const { objects } = fakeCore({
      branches: [
        state('a', 'feat/a', { tasks: [{ id: 't', origin: 'manual' }] }),
        state('b', 'feat/b', { repositoryId: 'r2', tasks: [{ id: 't', origin: 'ref' }] }),
        state('c', 'feat/c', { tasks: [{ id: 'x', origin: 'manual' }] }),
      ],
    })
    const names = async (filter: Parameters<typeof sharedBranches>[2]) =>
      (await sharedBranches(objects, NONE, filter)).branches.map((b) => b.name).sort()
    expect(await names({ taskId: 't' })).toEqual(['feat/a', 'feat/b'])
    expect(await names({ taskId: 'nobody' })).toEqual([])
    expect(await names({ repo: '/r/app' })).toEqual(['feat/a', 'feat/c'])
    expect(await names({ repo: '/r/app', name: 'feat/c' })).toEqual(['feat/c'])
    expect(await names({ repo: '/elsewhere' })).toEqual([])
  })
})

describe('a branch’s tasks, set by hand', () => {
  test('one, several or none: the core’s setTasks, on the branch of that repo and name', async () => {
    const { objects, calls } = fakeCore({ branches: [state('b', 'feat/b'), state('c', 'feat/b', { repositoryId: 'r2' })] })
    expect(await linkByHand(objects, '/r/app', 'feat/b', 't')).toBe(true)
    expect(await linkByHand(objects, '/r/api', 'feat/b', null)).toBe(true)
    expect(await setTasksByHand(objects, '/r/app', 'feat/b', ['t', 'x'])).toBe(true)
    expect(calls).toEqual(['setTasks b t', 'setTasks c ', 'setTasks b t,x'])
  })

  test('an unknown branch, repo or task changes nothing', async () => {
    const { objects, calls } = fakeCore({ branches: [state('b', 'feat/b')] })
    expect(await linkByHand(objects, '/r/app', 'nope', 't')).toBe(false)
    expect(await linkByHand(objects, '/elsewhere', 'feat/b', 't')).toBe(false)
    expect(await setTasksByHand(objects, '/r/app', 'feat/b', ['t', 'gone'])).toBe(false)
    expect(calls).toEqual([])
  })
})
